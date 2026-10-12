// The Self-monitor's pure part: URL construction from an origin. The edge
// cases (blank, trailing slash, whitespace) live here so the database part
// stays a thin idempotency check.
import { expect, test } from "bun:test";
import { selfMonitorUrl, SELF_MONITOR_INTERVAL_SEC } from "@/lib/self-monitor";

test("the health URL is the origin plus the health path", () => {
  expect(selfMonitorUrl("https://ping.example.com")).toBe("https://ping.example.com/api/health");
});

test("a trailing slash on the origin does not double up", () => {
  expect(selfMonitorUrl("https://ping.example.com/")).toBe("https://ping.example.com/api/health");
  expect(selfMonitorUrl("https://ping.example.com///")).toBe("https://ping.example.com/api/health");
});

test("surrounding whitespace is ignored", () => {
  expect(selfMonitorUrl("  https://ping.example.com  ")).toBe("https://ping.example.com/api/health");
});

test("a blank origin yields no URL", () => {
  expect(selfMonitorUrl("")).toBeNull();
  expect(selfMonitorUrl("   ")).toBeNull();
  expect(selfMonitorUrl(null)).toBeNull();
  expect(selfMonitorUrl(undefined)).toBeNull();
});

test("the self-monitor checks every 3 minutes", () => {
  expect(SELF_MONITOR_INTERVAL_SEC).toBe(180);
});
