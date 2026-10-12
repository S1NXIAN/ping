// The monitor status module is pure: the ladder, the slow predicate and the
// fleet aggregate are testable without a database, a clock or a server.
// Expected values are the domain rules from GLOSSARY.md ("Monitor status"):
// only up/down are measured health; paused is configuration; pending is the
// absence of any check yet. "Slow" is judged from the AVERAGE of the recent
// up checks, not the single last one.
import { expect, test } from "bun:test";
import { averageUpResponseMs, fleetStatus, isDegraded, monitorStatus } from "@/lib/monitor-status";

/** A window of up checks with the given response times. */
const ups = (...ms: number[]) => ms.map((m) => ({ status: "up", responseMs: m }));

test("slow is true when the average up-check time is over the threshold", () => {
  expect(isDegraded({ lastStatus: "up", slowThresholdMs: 500, recentChecks: ups(600, 700, 800) })).toBe(true);
});

test("slow is false when the average is within the threshold", () => {
  expect(isDegraded({ lastStatus: "up", slowThresholdMs: 500, recentChecks: ups(400, 300, 200) })).toBe(false);
});

test("one slow sample does not flip a healthy monitor to slow", () => {
  // Average = 300; a lone 900 cannot mislabel the monitor.
  expect(isDegraded({ lastStatus: "up", slowThresholdMs: 500, recentChecks: ups(100, 200, 900) })).toBe(false);
});

test("one fast sample does not hide a slow monitor", () => {
  // Average = 620; a lone 100 cannot rescue it.
  expect(isDegraded({ lastStatus: "up", slowThresholdMs: 500, recentChecks: ups(100, 800, 900, 700) })).toBe(true);
});

test("a down check in the window is ignored — only up checks count", () => {
  const window = [
    { status: "up", responseMs: 100 },
    { status: "down", responseMs: 9000 }, // a failed check's time never counts
    { status: "up", responseMs: 200 },
  ];
  // Average of the up checks = 150, under the threshold.
  expect(isDegraded({ lastStatus: "up", slowThresholdMs: 500, recentChecks: window })).toBe(false);
});

test("slow is false when no up check has a response time", () => {
  const window = [
    { status: "down", responseMs: 900 },
    { status: "up", responseMs: null },
  ];
  expect(isDegraded({ lastStatus: "up", slowThresholdMs: 500, recentChecks: window })).toBe(false);
});

test("slow is false for a down monitor however slow", () => {
  expect(isDegraded({ lastStatus: "down", slowThresholdMs: 500, recentChecks: ups(900, 900) })).toBe(false);
});

test("slow is false when no threshold is configured", () => {
  expect(isDegraded({ lastStatus: "up", slowThresholdMs: null, recentChecks: ups(900, 900) })).toBe(false);
});

test("averageUpResponseMs averages only timed up checks", () => {
  expect(averageUpResponseMs(ups(100, 200, 300))).toBe(200);
  expect(averageUpResponseMs([])).toBeNull();
  expect(averageUpResponseMs([{ status: "down", responseMs: 500 }])).toBeNull();
});

test("fleetStatus counts each status, with degraded as an up sub-count", () => {
  const counts = fleetStatus([
    { enabled: true, lastStatus: "up", slowThresholdMs: 500, recentChecks: ups(100) },
    { enabled: true, lastStatus: "up", slowThresholdMs: 500, recentChecks: ups(900) }, // up + slow
    { enabled: true, lastStatus: "down", slowThresholdMs: 500, recentChecks: ups(900) },
    { enabled: true, lastStatus: null, slowThresholdMs: null, recentChecks: [] }, // pending
    { enabled: false, lastStatus: "up", slowThresholdMs: null, recentChecks: [] }, // paused
  ]);
  expect(counts).toEqual({ up: 2, down: 1, degraded: 1, paused: 1, pending: 1 });
});

test("fleetStatus of an empty fleet is all zeroes", () => {
  expect(fleetStatus([])).toEqual({ up: 0, down: 0, degraded: 0, paused: 0, pending: 0 });
});

test("a disabled monitor is paused even when its last check was down", () => {
  expect(monitorStatus({ enabled: false, lastStatus: "down" })).toBe("paused");
  expect(monitorStatus({ enabled: false, lastStatus: "up" })).toBe("paused");
});

test("an enabled monitor reports its measured last check", () => {
  expect(monitorStatus({ enabled: true, lastStatus: "up" })).toBe("up");
  expect(monitorStatus({ enabled: true, lastStatus: "down" })).toBe("down");
});

test("an enabled monitor that has never been checked is pending", () => {
  expect(monitorStatus({ enabled: true, lastStatus: null })).toBe("pending");
});
