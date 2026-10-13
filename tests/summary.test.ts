// summarize() is the one place the dashboard turns a Scope (a Folder, or the
// whole Fleet) into the four stat cards and the header pills. It replaces the
// server-computed summary, so its numbers must equal the old ones exactly:
// counts by Monitor status, the mean 24h uptime over monitors that HAVE one,
// the summed 24h checks, the count of monitors with a real 24h failure, and
// the newest check across the Scope. Expected values are worked examples.
import { expect, test } from "bun:test";
import type { MonitorDTO } from "@/lib/ping-types";

/** A monitor with only the fields summarize() reads; the rest is filler. */
let seq = 0;
function mon(over: Partial<MonitorDTO> = {}): MonitorDTO {
  return {
    id: over.id ?? `m${seq++}`,
    name: "m",
    url: "https://m.example.com",
    method: "GET",
    intervalSec: 60,
    scheduleMode: "interval",
    scheduleTimes: [],
    timezone: null,
    enabled: true,
    folderId: null,
    folderName: null,
    account: null,
    pinned: false,
    position: 0,
    keyword: null,
    keywordMode: "contains",
    slowThresholdMs: null,
    degraded: false,
    createdAt: new Date(0).toISOString(),
    lastCheckAt: null,
    lastStatus: null,
    lastStatusCode: null,
    lastResponseMs: null,
    lastError: null,
    stats: {
      uptime24h: null,
      uptime7d: null,
      uptime30d: null,
      checks24h: 0,
      avgMs24h: null,
      minMs24h: null,
      maxMs24h: null,
      avgMs7d: null,
      lastDownAt: null,
      firstCheckAt: null,
      totalChecks: 0,
    },
    recentChecks: [],
    ...over,
  };
}

test("counts each status and averages only monitors that have a 24h uptime", async () => {
  const { summarize } = await import("@/lib/summary");
  const s = summarize([
    mon({ lastStatus: "up", stats: { ...mon().stats, uptime24h: 1, checks24h: 3 } }),
    mon({ lastStatus: "up", stats: { ...mon().stats, uptime24h: 0.5, checks24h: 2 } }),
    mon({ lastStatus: "down", stats: { ...mon().stats, uptime24h: 0.75, checks24h: 4 } }),
    mon({ enabled: false, lastStatus: "up" }), // paused
    mon({ lastStatus: null }), // pending, no uptime
  ]);
  expect(s.monitors).toBe(5);
  expect(s.up).toBe(2);
  expect(s.down).toBe(1);
  expect(s.paused).toBe(1);
  expect(s.pending).toBe(1);
  // Mean of 1, 0.5, 0.75 — the two monitors with no uptime are excluded.
  expect(s.avgUptime24h).toBeCloseTo(0.75, 10);
  expect(s.checks24h).toBe(9);
});

test("avgUptime24h is null when no monitor has a 24h uptime", async () => {
  const { summarize } = await import("@/lib/summary");
  expect(summarize([mon({ lastStatus: null })]).avgUptime24h).toBeNull();
  expect(summarize([]).avgUptime24h).toBeNull();
});

test("monitorsWithFailures24h counts only monitors with a REAL measured failure", async () => {
  const { summarize } = await import("@/lib/summary");
  const s = summarize([
    mon({ stats: { ...mon().stats, uptime24h: 0.5 } }), // a real failure
    mon({ stats: { ...mon().stats, uptime24h: 0 } }), // every check failed — a failure
    mon({ stats: { ...mon().stats, uptime24h: 1 } }), // perfect
    mon({ stats: { ...mon().stats, uptime24h: null } }), // no checks — NOT a failure
  ]);
  expect(s.monitorsWithFailures24h).toBe(2);
});

test("lastCheckAt is the newest check across the Scope, or null when none", async () => {
  const { summarize } = await import("@/lib/summary");
  const older = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const newer = new Date("2026-01-02T00:00:00.000Z").toISOString();
  const s = summarize([
    mon({ lastCheckAt: older }),
    mon({ lastCheckAt: newer }),
    mon({ lastCheckAt: null }),
  ]);
  expect(s.lastCheckAt).toBe(newer);
  expect(summarize([]).lastCheckAt).toBeNull();
});

test("an empty Scope is all zeroes and nulls", async () => {
  const { summarize } = await import("@/lib/summary");
  expect(summarize([])).toEqual({
    monitors: 0,
    up: 0,
    down: 0,
    degraded: 0,
    paused: 0,
    pending: 0,
    avgUptime24h: null,
    checks24h: 0,
    monitorsWithFailures24h: 0,
    lastCheckAt: null,
  });
});
