// The monitor status module is pure: the ladder, the degraded predicate and
// the fleet aggregate are testable without a database, a clock or a server.
// Expected values are the domain rules from GLOSSARY.md ("Monitor status"):
// only up/down are measured health; paused is configuration; pending is the
// absence of any check yet.
import { expect, test } from "bun:test";
import { fleetStatus, isDegraded, monitorStatus } from "@/lib/monitor-status";

test("degraded is true when the last check was up but over the threshold", () => {
  expect(isDegraded({ lastStatus: "up", lastResponseMs: 900, slowThresholdMs: 500 })).toBe(true);
});

test("degraded is false when the up check is within the threshold", () => {
  expect(isDegraded({ lastStatus: "up", lastResponseMs: 400, slowThresholdMs: 500 })).toBe(false);
});

test("degraded is false for a down monitor however slow", () => {
  expect(isDegraded({ lastStatus: "down", lastResponseMs: 900, slowThresholdMs: 500 })).toBe(false);
});

test("degraded is false when no threshold is configured", () => {
  expect(isDegraded({ lastStatus: "up", lastResponseMs: 900, slowThresholdMs: null })).toBe(false);
});

test("fleetStatus counts each status, with degraded as an up sub-count", () => {
  const counts = fleetStatus([
    { enabled: true, lastStatus: "up", lastResponseMs: 100, slowThresholdMs: 500 },
    { enabled: true, lastStatus: "up", lastResponseMs: 900, slowThresholdMs: 500 }, // up + degraded
    { enabled: true, lastStatus: "down", lastResponseMs: null, slowThresholdMs: 500 },
    { enabled: true, lastStatus: null, lastResponseMs: null, slowThresholdMs: null }, // pending
    { enabled: false, lastStatus: "up", lastResponseMs: 100, slowThresholdMs: null }, // paused
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
