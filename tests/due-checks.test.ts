// runDueChecks reports how many checks it actually ran. A monitor already
// in flight (runCheck returns null) must NOT be counted.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(async () => {
  await resetDb();
  // A slow check keeps the monitor in flight while runDueChecks runs.
  globalThis.fetch = mock(async () => {
    await new Promise((r) => setTimeout(r, 60));
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
});

test("an in-flight monitor is not counted as ran", async () => {
  const { runCheck, runDueChecks } = await import("@/lib/checker");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });

  const inFlight = runCheck(m); // registers m in the in-flight guard
  const result = await runDueChecks(); // m is due, but already running
  await inFlight;

  expect(result.ran).toBe(0);
});

test("a genuinely due monitor is counted once", async () => {
  const { runDueChecks } = await import("@/lib/checker");
  await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  const result = await runDueChecks();
  expect(result.ran).toBe(1);
  expect(result.up).toBe(1);
});
