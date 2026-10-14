// Every due check must be recorded, even when several finish at the same
// instant. runDueChecks fires checks MAX_CONCURRENCY (5) at a time; SQLite has
// one writer, so the per-check write must not hold a lock across round-trips or
// the siblings fail and their real results are thrown away. A fleet of fast
// services is the normal case, not an edge case.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(async () => {
  await resetDb();
  // A bare 200 with no delay: every check in a batch resolves together.
  globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
});

test("a full batch of simultaneous checks is recorded", async () => {
  const { runDueChecks } = await import("@/lib/checker");
  await db.monitor.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      name: `m${i}`,
      url: `https://m${i}.example.com`,
      intervalSec: 60,
    })),
  });

  const result = await runDueChecks();

  expect(result.ran).toBe(5);
  expect(await db.check.count()).toBe(5);
});

test("a monitor whose check was recorded is no longer due", async () => {
  const { runDueChecks } = await import("@/lib/checker");
  await db.monitor.createMany({
    data: Array.from({ length: 3 }, (_, i) => ({
      name: `m${i}`,
      url: `https://m${i}.example.com`,
      intervalSec: 60,
    })),
  });

  await runDueChecks();
  const second = await runDueChecks();

  // lastCheckAt was written for all three, so nothing is due a moment later.
  expect(second.ran).toBe(0);
  expect(await db.check.count()).toBe(3);
});

test("the check row and the monitor's headline status agree after a batch", async () => {
  const { runDueChecks } = await import("@/lib/checker");
  await db.monitor.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      name: `m${i}`,
      url: `https://m${i}.example.com`,
      intervalSec: 60,
    })),
  });

  await runDueChecks();

  const monitors = await db.monitor.findMany();
  for (const m of monitors) {
    const newest = await db.check.findFirst({
      where: { monitorId: m.id },
      orderBy: { checkedAt: "desc" },
    });
    expect(m.lastStatus).toBe("up");
    expect(m.lastCheckAt?.getTime()).toBe(newest?.checkedAt.getTime());
  }
});
