// A down during an active maintenance window is recorded but NOT notified;
// the deferred "down" fires on the first check after the window ends.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const realFetch = globalThis.fetch;
let delivered: Array<{ body: unknown }>;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(async () => {
  await resetDb();
  delivered = [];
  globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      // The webhook sender always sends a JSON string body (webhooks.ts).
      const raw = init.body;
      if (typeof raw !== "string") throw new Error(`expected a string body, got ${typeof raw}`);
      delivered.push({ body: JSON.parse(raw) });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 503 }); // monitor is down
  }) as unknown as typeof fetch;
});

test("down during maintenance is recorded but suppressed, then fires after", async () => {
  const { runCheck } = await import("@/lib/checker");
  await db.webhookChannel.create({
    data: { name: "slack", url: "https://hooks.example.com/x", notifyDown: true },
  });
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  // A window that is active right now (started a minute ago, ends in an hour).
  await db.maintenanceWindow.create({
    data: {
      monitorId: m.id,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
    },
  });

  await runCheck(m);
  await new Promise((r) => setTimeout(r, 20));
  expect(delivered.length).toBe(0); // suppressed
  const checks = await db.check.findMany({ where: { monitorId: m.id } });
  expect(checks.length).toBe(1); // …but the downtime is still recorded
  expect(checks[0].status).toBe("down");
});

test("a down outside any window is notified", async () => {
  const { runCheck } = await import("@/lib/checker");
  await db.webhookChannel.create({
    data: { name: "slack", url: "https://hooks.example.com/x", notifyDown: true },
  });
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  await runCheck(m);
  await new Promise((r) => setTimeout(r, 20));
  expect(delivered.length).toBe(1);
});
