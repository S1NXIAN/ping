// Keyword checks through the real runCheck path: a 200 whose body fails the
// keyword is recorded as a genuine down check.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(async () => {
  await resetDb();
});

function respondWith(body: string, status = 200) {
  globalThis.fetch = mock(
    async () => new Response(body, { status, headers: { "content-type": "text/plain" } }),
  ) as unknown as typeof fetch;
}

async function monitor(keyword: string | null, keywordMode = "contains") {
  return db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", keyword, keywordMode },
  });
}

test("contains: a 200 with the keyword is up", async () => {
  respondWith("welcome to the app");
  const { runCheck } = await import("@/lib/checker");
  const m = await monitor("welcome");
  const c = await runCheck(m);
  expect(c!.status).toBe("up");
});

test("contains: a 200 missing the keyword is down", async () => {
  respondWith("maintenance page");
  const { runCheck } = await import("@/lib/checker");
  const m = await monitor("welcome");
  const c = await runCheck(m);
  expect(c!.status).toBe("down");
  expect(c!.error).toContain("not found");
});

test("excludes: a 200 containing the forbidden word is down", async () => {
  respondWith("error: something broke");
  const { runCheck } = await import("@/lib/checker");
  const m = await monitor("error", "excludes");
  const c = await runCheck(m);
  expect(c!.status).toBe("down");
});

test("keyword match is case-insensitive", async () => {
  respondWith("WELCOME");
  const { runCheck } = await import("@/lib/checker");
  const m = await monitor("welcome");
  const c = await runCheck(m);
  expect(c!.status).toBe("up");
});

test("no keyword: a 200 is up regardless of body", async () => {
  respondWith("anything at all");
  const { runCheck } = await import("@/lib/checker");
  const m = await monitor(null);
  const c = await runCheck(m);
  expect(c!.status).toBe("up");
});
