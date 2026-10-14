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

test("a monitor with an unreadable timezone does not abort the whole tick", async () => {
  // A stale stored zone used to make the due-filter throw, so NO monitor of
  // any kind got checked. It must degrade to UTC and leave the others running.
  const { runDueChecks } = await import("@/lib/checker");
  await db.monitor.create({
    data: { name: "good", url: "https://good.example.com", intervalSec: 60 },
  });
  await db.monitor.create({
    data: {
      name: "bad-zone",
      url: "https://bad.example.com",
      scheduleMode: "times",
      scheduleTimes: "03:00,13:00",
      timezone: "Not/AZone",
    },
  });
  const result = await runDueChecks();
  // Both are due (the times monitor has never checked); neither aborts the run.
  expect(result.ran).toBe(2);
});
