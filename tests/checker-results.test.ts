// runCheck is the one rule the whole product rests on: what counts as up, and
// what a failure records. No test mocked anything but a 200, so the up/down
// boundary and the error mapping were unverified. Each case here is a worked
// example from the spec (README: "2xx/3xx up", "records ... the exact error").
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(async () => {
  await resetDb();
});

function monitor() {
  return db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
}

/** Make fetch return a bare response with `status`. */
function respondWith(status: number) {
  globalThis.fetch = mock(async () => new Response(null, { status })) as unknown as typeof fetch;
}

/** Make fetch reject with a Node-style network error. */
function rejectWith(name: string, code?: string) {
  globalThis.fetch = mock(async () => {
    const e = new Error("boom");
    e.name = name;
    if (code) (e as unknown as { cause: unknown }).cause = { code };
    throw e;
  }) as unknown as typeof fetch;
}

test("a 2xx response is recorded as up", async () => {
  respondWith(200);
  const { runCheck } = await import("@/lib/checker");
  const c = await runCheck(await monitor());
  expect(c!.status).toBe("up");
  expect(c!.statusCode).toBe(200);
});

test("a 3xx response is still up (redirects are followed)", async () => {
  respondWith(301);
  const { runCheck } = await import("@/lib/checker");
  const c = await runCheck(await monitor());
  expect(c!.status).toBe("up");
  expect(c!.statusCode).toBe(301);
});

test("a 4xx response is down, and the error names the status", async () => {
  respondWith(404);
  const { runCheck } = await import("@/lib/checker");
  const c = await runCheck(await monitor());
  expect(c!.status).toBe("down");
  expect(c!.statusCode).toBe(404);
  expect(c!.error).toBe("HTTP 404");
});

test("a 5xx response is down, and the reason phrase is kept", async () => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 503, statusText: "Service Unavailable" }),
  ) as unknown as typeof fetch;
  const { runCheck } = await import("@/lib/checker");
  const c = await runCheck(await monitor());
  expect(c!.status).toBe("down");
  expect(c!.error).toBe("HTTP 503 Service Unavailable");
});

test("a refused connection is down with a readable reason", async () => {
  rejectWith("TypeError", "ECONNREFUSED");
  const { runCheck } = await import("@/lib/checker");
  const c = await runCheck(await monitor());
  expect(c!.status).toBe("down");
  expect(c!.statusCode).toBeNull();
  expect(c!.error).toBe("Connection refused");
});

test("a failed DNS lookup is down with a readable reason", async () => {
  rejectWith("TypeError", "ENOTFOUND");
  const { runCheck } = await import("@/lib/checker");
  const c = await runCheck(await monitor());
  expect(c!.status).toBe("down");
  expect(c!.error).toBe("DNS lookup failed");
});

test("a timeout is down and says how long it waited", async () => {
  rejectWith("TimeoutError");
  const { runCheck } = await import("@/lib/checker");
  const c = await runCheck(await monitor());
  expect(c!.status).toBe("down");
  expect(c!.error).toBe("Timed out after 15s");
});

test("the check writes both the history row and the monitor's last status", async () => {
  respondWith(500);
  const { runCheck } = await import("@/lib/checker");
  const m = await monitor();
  const c = await runCheck(m);

  const stored = await db.monitor.findUniqueOrThrow({ where: { id: m.id } });
  expect(stored.lastStatus).toBe("down");
  expect(stored.lastStatusCode).toBe(500);
  expect(stored.lastCheckAt?.getTime()).toBe(c!.checkedAt.getTime());
  // The two writes agree — the card never shows a status its own history
  // contradicts.
  expect(await db.check.count({ where: { monitorId: m.id } })).toBe(1);
});
