// Integration: the down-alert delay ("confirmations") through runCheck's real
// DB writes. The seam is runCheck(monitor) + the recorded Check rows and the
// webhook channels it notifies — never internals.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Monitor } from "@prisma/client";
import { db, resetDb } from "./helpers/test-db";

const realFetch = globalThis.fetch;
let delivered: Array<{ url: string; body: unknown }>;

function webhookCapture() {
  delivered = [];
  globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
    // Webhook POSTs carry a JSON body; the monitor's own check GET/HEAD does not.
    if (init?.method === "POST") {
      delivered.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 204 });
    }
    // A monitor check: pretend the target is down (503).
    return new Response(null, { status: 503 });
  }) as unknown as typeof fetch;
}

async function makeMonitor(alertDelay: number): Promise<Monitor> {
  return db.monitor.create({
    data: {
      name: "svc",
      url: "https://svc.example.com",
      intervalSec: 60,
      alertDelay,
    },
  });
}

async function channel() {
  return db.webhookChannel.create({
    data: { name: "slack", url: "https://hooks.example.com/x", notifyDown: true, notifyUp: true },
  });
}

beforeEach(async () => {
  await resetDb();
  webhookCapture();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("down-alert delay", () => {
  test("alertDelay=0 notifies on the very first failure", async () => {
    await channel();
    const m = await makeMonitor(0);
    const { runCheck } = await import("@/lib/checker");
    await runCheck(m);
    // fireWebhooks is voided inside runCheck — flush the microtask queue.
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered.length).toBe(1);
    expect(delivered[0].body).toMatchObject({ event: "down" });
  });

  test("alertDelay=2 holds the first two failures, then fires on the third", async () => {
    await channel();
    let m = await makeMonitor(2);
    const { runCheck } = await import("@/lib/checker");

    m = (await runCheck(m)) ? await db.monitor.findUniqueOrThrow({ where: { id: m.id } }) : m;
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered.length).toBe(0); // 1/3 confirmations

    m = await runCheck(m).then(() => db.monitor.findUniqueOrThrow({ where: { id: m.id } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered.length).toBe(0); // 2/3 confirmations

    m = await runCheck(m).then(() => db.monitor.findUniqueOrThrow({ where: { id: m.id } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered.length).toBe(1); // 3/3 — the deferred alert fires now
    expect(delivered[0].body).toMatchObject({ event: "down" });
  });

  test("downtime is recorded on every failed check regardless of delay", async () => {
    const m = await makeMonitor(5);
    const { runCheck } = await import("@/lib/checker");
    await runCheck(m);
    const checks = await db.check.findMany({ where: { monitorId: m.id } });
    expect(checks.length).toBe(1);
    expect(checks[0].status).toBe("down");
  });

  test("a success resets the streak so the count starts over", async () => {
    const m = await makeMonitor(2);
    const { runCheck } = await import("@/lib/checker");
    const fresh = () => db.monitor.findUniqueOrThrow({ where: { id: m.id } });

    let cur = await runCheck(m).then(fresh); // down 1/3
    globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    cur = await runCheck(cur).then(fresh); // up → reset
    expect(cur.consecutiveDowns).toBe(0);
  });
});
