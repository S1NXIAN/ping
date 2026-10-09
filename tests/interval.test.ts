// The custom check-interval grammar (H/M) and its formatter. The parser stores
// total seconds — the unit the API, DB and scheduler already speak — so no wire
// format changed. Seconds are deliberately not a unit: the scheduler wakes every
// 30s, and whole minutes are all exact on that grid, so omitting S keeps every
// value the grammar can express honour-able. Days are not a unit either — the
// top unit is the hour and the ceiling is 24 of them.
import { expect, test } from "bun:test";
import { INTERVAL_MAX_SEC, INTERVAL_MIN_SEC, formatInterval, parseInterval } from "@/lib/ping-client";

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

test("parses a single unit", () => {
  expect(seconds("4M")).toBe(240);
  expect(seconds("1M")).toBe(60);
  expect(seconds("1H")).toBe(3600);
  expect(seconds("24H")).toBe(86400);
});

test("parses compound values", () => {
  expect(seconds("4H30M")).toBe(16200);
  expect(seconds("1H 30M")).toBe(5400);
  expect(seconds("23H59M")).toBe(86340);
  expect(seconds("4h 30m")).toBe(16200);
});

test("case and separators are interchangeable", () => {
  expect(seconds("4m")).toBe(240);
  expect(seconds("4h:30m")).toBe(seconds("4H:30M"));
  expect(seconds("4H 30M")).toBe(seconds("4H:30M"));
  expect(seconds("4H30M")).toBe(seconds("4H:30M"));
});

test("units are unbounded — only the total is capped", () => {
  // A per-unit cap (M<=59) would wrongly reject 90M; the grammar sums first
  // and range-checks the total.
  expect(seconds("90M")).toBe(5400);
  expect(seconds("1440M")).toBe(INTERVAL_MAX_SEC);
});

test("rejects days — the top unit is the hour", () => {
  expect(errorOf("1D")).toMatch(/unknown unit|use H or M/i);
  expect(errorOf("1d")).toMatch(/unknown unit|use H or M/i);
});

test("rejects seconds — the scheduler cannot honour them", () => {
  // 4M:16S = 256s, but ticks land every 30s, so it would fire at 270s.
  // Rather than silently round, the unit is not offered at all.
  expect(errorOf("4M:16S")).toMatch(/30\s*s|second/i);
  expect(errorOf("16S")).toMatch(/30\s*s|second/i);
});

test("rejects a total below the 60s minimum", () => {
  expect(errorOf("0M")).toMatch(/at least|minimum|1M/i);
});

test("rejects a total above the 24-hour maximum", () => {
  expect(errorOf("25H")).toMatch(/at most|maximum|24/i);
  expect(errorOf("48H")).toMatch(/at most|maximum|24/i);
  expect(errorOf("1441M")).toMatch(/at most|maximum|24/i);
});

test("rejects malformed input", () => {
  expect(errorOf("")).toBeTruthy();
  expect(errorOf("   ")).toBeTruthy();
  expect(errorOf("4")).toBeTruthy(); // a bare number has no unit
  expect(errorOf("4X")).toBeTruthy(); // unknown unit
  expect(errorOf("M")).toBeTruthy(); // unit without a count
  expect(errorOf("4M4M")).toMatch(/twice|duplicate|repeat/i);
  expect(errorOf("-4M")).toBeTruthy();
  expect(errorOf("4M:")).toBeTruthy();
});

test("rejects inherited Object keys as units", () => {
  // `unit in MAP` walks the prototype chain, so "constructor" would pass and
  // multiply by a function -> NaN. The lookup must own-only.
  expect(errorOf("4constructor")).toBeTruthy();
  expect(errorOf("4toString")).toBeTruthy();
  expect(errorOf("4valueOf")).toBeTruthy();
  expect(errorOf("4hasOwnProperty")).toBeTruthy();
});

test("repeated separators are collapsed, not rejected", () => {
  expect(seconds("4M::5H")).toBe(seconds("4M:5H"));
  expect(seconds("1H  12M")).toBe(seconds("1H 12M"));
});

test("trims surrounding whitespace", () => {
  expect(seconds("  4M  ")).toBe(240);
});

test("formatInterval renders compound durations, hours as the top unit", () => {
  expect(formatInterval(86400)).toBe("24h");
  expect(formatInterval(16200)).toBe("4h 30m");
  expect(formatInterval(5400)).toBe("1h 30m");
  expect(formatInterval(240)).toBe("4m");
  // A legacy sub-minute value still renders truthfully.
  expect(formatInterval(90)).toBe("1m 30s");
});

test("formatInterval output is unchanged for every preset", () => {
  // The dropdown presets must render exactly as before.
  expect(formatInterval(60)).toBe("1m");
  expect(formatInterval(120)).toBe("2m");
  expect(formatInterval(300)).toBe("5m");
  expect(formatInterval(600)).toBe("10m");
  expect(formatInterval(1800)).toBe("30m");
  expect(formatInterval(3600)).toBe("1h");
  expect(formatInterval(21600)).toBe("6h");
  expect(formatInterval(43200)).toBe("12h");
  expect(formatInterval(86400)).toBe("24h");
});

test("parse and format round-trip a custom value", () => {
  const s = seconds("4H30M");
  expect(formatInterval(s)).toBe("4h 30m");
  // Re-seeding the field from the stored seconds yields a parseable value.
  expect(seconds(formatInterval(s).replace(/\s+/g, ""))).toBe(s);
});

test("every H/M value the formatter emits is parseable", () => {
  // The editor seeds its field with formatInterval(stored); if that output
  // weren't parseable the monitor could never be saved unchanged. H/M can only
  // express whole minutes, so the formatter must not emit `s` for them.
  for (const s of [60, 240, 3600, 5400, 16200, 43200, 86400]) {
    const formatted = formatInterval(s);
    expect(formatted).not.toContain("s");
    expect(seconds(formatted.replace(/\s+/g, ""))).toBe(s);
  }
});

test("exported bounds match the documented range", () => {
  expect(INTERVAL_MIN_SEC).toBe(60);
  expect(INTERVAL_MAX_SEC).toBe(86400); // 24 hours
});
