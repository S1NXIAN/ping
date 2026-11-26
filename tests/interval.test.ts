// The custom check-interval grammar (whole minutes) and its formatter. The
// parser stores total seconds — the unit the API, DB and scheduler already
// speak — so no wire format changed. Seconds are deliberately not a unit: the
// scheduler wakes every 30s, and whole minutes are all exact on that grid.
import { expect, test } from "bun:test";
import { INTERVAL_MAX_SEC, INTERVAL_MIN_SEC, formatDuration, formatInterval, parseInterval } from "@/lib/ping-client";

const seconds = (input: string) => {
  const r = parseInterval(input);
  if ("error" in r) throw new Error(`expected ${input} to parse, got: ${r.error}`);
  return r.seconds;
};
const errorOf = (input: string) => {
  const r = parseInterval(input);
  if (!("error" in r)) throw new Error(`expected ${input} to fail, got ${r.seconds}s`);
  return r.error;
};

test("parses whole minutes", () => {
  expect(seconds("3M")).toBe(180);
  expect(seconds("4M")).toBe(240);
  expect(seconds("12M")).toBe(720);
  expect(seconds("15M")).toBe(900);
});

test("the unit is case-insensitive and surrounding whitespace is trimmed", () => {
  expect(seconds("4m")).toBe(240);
  expect(seconds("  4M  ")).toBe(240);
});

test("rejects hours and days — M is the only unit", () => {
  expect(errorOf("1H")).toMatch(/unknown unit|use M/i);
  expect(errorOf("1D")).toMatch(/unknown unit|use M/i);
});

test("rejects seconds — the scheduler cannot honour them", () => {
  expect(errorOf("16S")).toMatch(/30\s*s|second/i);
  expect(errorOf("90S")).toMatch(/30\s*s|second/i);
});

test("rejects a total below the 3-minute minimum", () => {
  expect(errorOf("0M")).toMatch(/at least|minimum|3/i);
  expect(errorOf("2M")).toMatch(/at least|minimum|3/i);
});

test("rejects a total above the 15-minute maximum", () => {
  expect(errorOf("16M")).toMatch(/at most|maximum|15/i);
  expect(errorOf("60M")).toMatch(/at most|maximum|15/i);
});

test("rejects malformed input", () => {
  expect(errorOf("")).toBeTruthy();
  expect(errorOf("   ")).toBeTruthy();
  expect(errorOf("4")).toBeTruthy(); // a bare number has no unit
  expect(errorOf("M")).toBeTruthy(); // unit without a count
  expect(errorOf("4M5M")).toBeTruthy(); // one value, not a compound
  expect(errorOf("-4M")).toBeTruthy();
  expect(errorOf("4M:")).toBeTruthy();
});

test("formatInterval renders whole minutes", () => {
  expect(formatInterval(180)).toBe("3m");
  expect(formatInterval(240)).toBe("4m");
  expect(formatInterval(900)).toBe("15m");
});

test("the presets round-trip through the formatter and parser", () => {
  // The editor seeds its field with formatInterval(stored); if that output
  // weren't parseable the monitor could never be saved unchanged.
  for (const s of [180, 240, 300, 600, 900]) {
    expect(seconds(formatInterval(s))).toBe(s);
  }
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
  expect(INTERVAL_MAX_SEC).toBe(900); // 15 minutes = free-tier idle spin-down
});
