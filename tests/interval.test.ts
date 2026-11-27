// The interval formatter and bounds. Intervals are whole minutes stored as
// seconds — the unit the API, DB and scheduler speak. Seconds are not a unit:
// the scheduler wakes every 30s, and whole minutes are all exact on that grid.
import { expect, test } from "bun:test";
import { INTERVAL_MAX_SEC, INTERVAL_MIN_SEC, formatDuration, formatInterval } from "@/lib/ping-client";

test("formatInterval renders whole minutes", () => {
  expect(formatInterval(180)).toBe("3m");
  expect(formatInterval(240)).toBe("4m");
  expect(formatInterval(600)).toBe("10m");
});

test("formatDuration renders a duration, seconds down to the unit", () => {
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(600)).toBe("10m");
  expect(formatDuration(3600)).toBe("1h 0m");
  expect(formatDuration(11100)).toBe("3h 5m");
  expect(formatDuration(90000)).toBe("1d 1h");
});

test("formatDuration coarse reads an outage: no seconds, padded minutes", () => {
  // The card and the incidents sheet show the same outage, so they must read
  // the same: sub-minute is "<1m" (not a stopwatch second), and the minute
  // field is zero-padded.
  expect(formatDuration(45, { coarse: true })).toBe("<1m");
  expect(formatDuration(600, { coarse: true })).toBe("10m");
  expect(formatDuration(11100, { coarse: true })).toBe("3h 05m");
  expect(formatDuration(90000, { coarse: true })).toBe("1d 1h");
});

test("exported bounds match the documented range", () => {
  expect(INTERVAL_MIN_SEC).toBe(180);
  expect(INTERVAL_MAX_SEC).toBe(600); // 10 minutes: 15 would let a free-tier service cold-boot
});
