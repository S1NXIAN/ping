// The custom check-interval grammar (D/H/M) and its formatter. The parser
// stores total seconds — the unit the API, DB and scheduler already speak —
// so no wire format changed. Seconds are deliberately not a unit: the
// scheduler wakes every 30s, so a sub-minute interval could not be honoured
// exactly, and the honesty contract forbids displaying a cadence we can't keep.
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
  expect(seconds("48H")).toBe(172800);
  expect(seconds("2D")).toBe(172800);
});

test("units are unbounded — only the total is capped", () => {
  // 48H is the same duration as 2D; a per-unit cap (H<=23) would wrongly
  // reject it, so the grammar sums first and range-checks the total.
  expect(seconds("48H")).toBe(seconds("2D"));
  expect(seconds("90M")).toBe(5400);
  expect(seconds("168H")).toBe(INTERVAL_MAX_SEC);
  expect(seconds("10080M")).toBe(INTERVAL_MAX_SEC);
});

test("parses compound values", () => {
  expect(seconds("3D:15M")).toBe(260100);
  expect(seconds("1D12H30M")).toBe(131400);
  expect(seconds("1D 12H 30M")).toBe(131400);
  expect(seconds("1d 12h 30m")).toBe(131400);
});

test("case and separators are interchangeable", () => {
  expect(seconds("4m")).toBe(240);
  expect(seconds("3d:15m")).toBe(seconds("3D:15M"));
  expect(seconds("3D 15M")).toBe(seconds("3D:15M"));
  expect(seconds("3D15M")).toBe(seconds("3D:15M"));
});

test("rejects seconds — the scheduler cannot honour them", () => {
  // 4M:16S = 256s, but ticks land every 30s, so it would fire at 270s.
  // Rather than silently round, the unit is not offered at all.
  expect(errorOf("4M:16S")).toMatch(/30\s*s|second/i);
  expect(errorOf("16S")).toMatch(/30\s*s|second/i);
});

test("rejects a total below the 60s minimum", () => {
  expect(errorOf("0M")).toMatch(/at least|minimum|60/i);
});

test("rejects a total above the 7-day maximum", () => {
  expect(errorOf("8D")).toMatch(/at most|maximum|7/i);
  expect(errorOf("169H")).toMatch(/at most|maximum|7/i);
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
  expect(seconds("1D  12H")).toBe(seconds("1D 12H"));
});

test("trims surrounding whitespace", () => {
  expect(seconds("  4M  ")).toBe(240);
});

test("formatInterval renders compound durations", () => {
  // 3D:15M is 260100s — the old single-unit formatter showed "4335m".
  expect(formatInterval(260100)).toBe("3d 15m");
  expect(formatInterval(172800)).toBe("2d");
  expect(formatInterval(131400)).toBe("1d 12h 30m");
  expect(formatInterval(90)).toBe("1m 30s");
  expect(formatInterval(240)).toBe("4m");
});

test("formatInterval output is unchanged for every preset", () => {
  // The six dropdown presets must render exactly as before.
  expect(formatInterval(60)).toBe("1m");
  expect(formatInterval(120)).toBe("2m");
  expect(formatInterval(300)).toBe("5m");
  expect(formatInterval(600)).toBe("10m");
  expect(formatInterval(1800)).toBe("30m");
  expect(formatInterval(3600)).toBe("1h");
  expect(formatInterval(21600)).toBe("6h");
  expect(formatInterval(43200)).toBe("12h");
  expect(formatInterval(86400)).toBe("1d");
});

test("parse and format round-trip a custom value", () => {
  const s = seconds("3D:15M");
  expect(formatInterval(s)).toBe("3d 15m");
  // Re-seeding the field from the stored seconds yields a parseable value.
  expect(seconds(formatInterval(s).replace(/\s+/g, ""))).toBe(s);
});

test("every D/H/M value the formatter emits is parseable", () => {
  // The editor seeds its field with formatInterval(stored); if that output
  // weren't parseable the monitor could never be saved unchanged. D/H/M can
  // only express whole minutes, so the formatter must not emit `s` for them.
  for (const s of [60, 240, 3600, 5400, 86400, 172800, 260100]) {
    const formatted = formatInterval(s);
    expect(formatted).not.toContain("s");
    expect(seconds(formatted.replace(/\s+/g, ""))).toBe(s);
  }
});

test("exported bounds match the documented range", () => {
  expect(INTERVAL_MIN_SEC).toBe(60);
  expect(INTERVAL_MAX_SEC).toBe(604800); // 7 days
});
