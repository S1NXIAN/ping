// Times-of-day scheduling: a monitor that checks at fixed clock times every
// day, interpreted in its own IANA timezone. All of this is pure so the
// timezone math is testable without a server, a clock, or a database.
//
// The clock times are stored as "HH:MM" strings in the monitor's own zone.
// Converting them to instants needs Intl (there is no arithmetic shortcut
// across a DST boundary), so every expectation below is a known-good literal.
import { expect, test } from "bun:test";
import {
  MAX_SCHEDULE_TIMES,
  formatNextRun,
  hasTimeAt,
  isTimesDue,
  mostRecentScheduledInstant,
  nextScheduledInstant,
  nominalPeriodSec,
  parseTimes,
  zonedWallClockToUtc,
} from "@/lib/schedule";

const at = (iso: string) => Date.parse(iso);

test("parseTimes sorts, dedupes and drops malformed entries", () => {
  expect(parseTimes("13:00,03:00")).toEqual(["03:00", "13:00"]);
  expect(parseTimes("13:00,13:00")).toEqual(["13:00"]);
  expect(parseTimes(" 13:00 , 03:00 ")).toEqual(["03:00", "13:00"]);
  expect(parseTimes("25:00,03:00")).toEqual(["03:00"]);
  expect(parseTimes("3:00")).toEqual([]); // must be zero-padded HH:MM
  expect(parseTimes("")).toEqual([]);
  expect(parseTimes(null)).toEqual([]);
  expect(parseTimes("13:00,13:00,13:00")).toEqual(["13:00"]);
});

test("parseTimes caps the list at MAX_SCHEDULE_TIMES", () => {
  const many = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, "0")}:00`).join(",");
  expect(parseTimes(many)).toHaveLength(MAX_SCHEDULE_TIMES);
});

test("zonedWallClockToUtc converts a wall clock in a fixed-offset zone", () => {
  // Asia/Manila is UTC+8 year-round (no DST), so this is pure arithmetic.
  // 2026-03-10 13:00 Manila == 2026-03-10 05:00 UTC.
  expect(zonedWallClockToUtc(2026, 3, 10, 13, 0, "Asia/Manila")).toBe(at("2026-03-10T05:00:00Z"));
  // 03:00 Manila == 19:00 UTC the PREVIOUS day.
  expect(zonedWallClockToUtc(2026, 3, 10, 3, 0, "Asia/Manila")).toBe(at("2026-03-09T19:00:00Z"));
});

test("zonedWallClockToUtc respects a DST offset change", () => {
  // America/New_York: EST (UTC-5) before 2026-03-08, EDT (UTC-4) after.
  expect(zonedWallClockToUtc(2026, 3, 1, 13, 0, "America/New_York")).toBe(at("2026-03-01T18:00:00Z"));
  expect(zonedWallClockToUtc(2026, 3, 20, 13, 0, "America/New_York")).toBe(at("2026-03-20T17:00:00Z"));
});

test("mostRecentScheduledInstant finds the latest time at or before now", () => {
  // Now = 2026-03-10 06:00 UTC = 14:00 Manila -> 13:00 Manila today (05:00 UTC).
  const now = at("2026-03-10T06:00:00Z");
  expect(mostRecentScheduledInstant(["13:00", "03:00"], "Asia/Manila", now)).toBe(at("2026-03-10T05:00:00Z"));
});

test("mostRecentScheduledInstant reaches back to yesterday before the first time", () => {
  // Now = 2026-03-10 00:00 UTC = 08:00 Manila. Latest at-or-before is
  // 03:00 Manila today = 2026-03-09 19:00 UTC.
  const now = at("2026-03-10T00:00:00Z");
  expect(mostRecentScheduledInstant(["13:00", "03:00"], "Asia/Manila", now)).toBe(at("2026-03-09T19:00:00Z"));
});

test("nextScheduledInstant finds the soonest time strictly after now", () => {
  // Now = 2026-03-10 06:00 UTC = 14:00 Manila -> next is 03:00 Manila tomorrow.
  const now = at("2026-03-10T06:00:00Z");
  expect(nextScheduledInstant(["13:00", "03:00"], "Asia/Manila", now)).toBe(at("2026-03-10T19:00:00Z"));
});

test("nextScheduledInstant skips the instant exactly at now", () => {
  // Now is exactly 13:00 Manila -> the next run is tomorrow's, not this one.
  const now = at("2026-03-10T05:00:00Z");
  expect(nextScheduledInstant(["13:00"], "Asia/Manila", now)).toBe(at("2026-03-11T05:00:00Z"));
});

test("nextScheduledInstant is null with no times", () => {
  expect(nextScheduledInstant([], "Asia/Manila", at("2026-03-10T06:00:00Z"))).toBeNull();
});

test("formatNextRun reads as the next clock time, not the whole list", () => {
  const now = at("2026-03-10T06:00:00Z"); // 14:00 Manila
  expect(formatNextRun(["13:00", "03:00"], "Asia/Manila", now)).toBe("3:00 AM");
  // A 12-time schedule still yields one clock time, never a flood. Here all
  // of today's times are past, so the next is tomorrow's first.
  const many = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  expect(formatNextRun(many, "Asia/Manila", now)).toBe("12:00 AM");
});

test("isTimesDue fires on the first ever check", () => {
  const now = at("2026-03-10T06:00:00Z");
  expect(isTimesDue(["13:00", "03:00"], "Asia/Manila", null, now)).toBe(true);
});

test("isTimesDue does not fire twice for the same instant", () => {
  const now = at("2026-03-10T06:00:00Z"); // 14:00 Manila, last slot 13:00 Manila
  const justRan = at("2026-03-10T05:00:01Z"); // ran right after 13:00 Manila
  expect(isTimesDue(["13:00", "03:00"], "Asia/Manila", justRan, now)).toBe(false);
});

test("isTimesDue catches up a check missed while asleep", () => {
  // Scheduled 13:00 Manila (05:00 UTC). PING was asleep then; it wakes at
  // 06:00 UTC and must still run the 13:00 check, late but honestly.
  const now = at("2026-03-10T06:00:00Z");
  const lastCheck = at("2026-03-10T04:00:00Z"); // before the 05:00 UTC slot
  expect(isTimesDue(["13:00", "03:00"], "Asia/Manila", lastCheck, now)).toBe(true);
});

test("isTimesDue bounds the catch-up to the most recent slot only", () => {
  // Asleep 12:58 -> 04:00 next day Manila. Two slots passed (13:00, 03:00).
  // Waking must run ONE check (the latest slot), not both.
  const now = at("2026-03-09T20:30:00Z"); // 2026-03-10 04:30 Manila
  const lastCheck = at("2026-03-09T04:58:00Z"); // 12:58 Manila the previous day
  const latest = mostRecentScheduledInstant(["13:00", "03:00"], "Asia/Manila", now);
  expect(latest).toBe(at("2026-03-09T19:00:00Z")); // 03:00 Manila
  expect(isTimesDue(["13:00", "03:00"], "Asia/Manila", lastCheck, now)).toBe(true);
  // And a check already run at the latest slot is NOT due again.
  expect(isTimesDue(["13:00", "03:00"], "Asia/Manila", latest, now)).toBe(false);
});

test("isTimesDue is false with no times configured", () => {
  const now = at("2026-03-10T06:00:00Z");
  expect(isTimesDue([], "Asia/Manila", null, now)).toBe(false);
});

test("nominalPeriodSec is the largest gap between consecutive times", () => {
  // 03:00 -> 13:00 = 10h; 13:00 -> 03:00 (next day) = 14h. Largest = 14h.
  expect(nominalPeriodSec(["13:00", "03:00"])).toBe(14 * 3600);
  // A single time repeats every 24h.
  expect(nominalPeriodSec(["13:00"])).toBe(24 * 3600);
  // Three evenly-ish spaced times: largest gap wins.
  expect(nominalPeriodSec(["00:00", "06:00", "12:00"])).toBe(12 * 3600);
  // No times: fall back to a day so callers never divide by zero.
  expect(nominalPeriodSec([])).toBe(24 * 3600);
});

test("zonedWallClockToUtc resolves a nonexistent time to the gap-closing instant", () => {
  // New York springs forward on 2026-03-08: 01:59:59 EST -> 03:00:00 EDT, so
  // 02:30 never happens. "Skip forward" means the check runs the moment the
  // gap closes — 03:00 EDT (07:00Z), not 03:30.
  expect(zonedWallClockToUtc(2026, 3, 8, 2, 30, "America/New_York")).toBe(at("2026-03-08T07:00:00Z"));
  expect(zonedWallClockToUtc(2026, 3, 8, 2, 0, "America/New_York")).toBe(at("2026-03-08T07:00:00Z"));
  // The instants either side of the gap are unaffected.
  expect(zonedWallClockToUtc(2026, 3, 8, 1, 30, "America/New_York")).toBe(at("2026-03-08T06:30:00Z"));
  expect(zonedWallClockToUtc(2026, 3, 8, 3, 0, "America/New_York")).toBe(at("2026-03-08T07:00:00Z"));
});

test("zonedWallClockToUtc runs an ambiguous time once, at the first occurrence", () => {
  // New York falls back on 2026-11-01: 01:30 happens twice (EDT then EST).
  // Running once means the FIRST occurrence, 01:30 EDT = 05:30Z.
  expect(zonedWallClockToUtc(2026, 11, 1, 1, 30, "America/New_York")).toBe(at("2026-11-01T05:30:00Z"));
});

test("a spring-forward schedule fires once, not late", () => {
  // A 02:30 daily monitor on transition day is due at the gap close (07:00Z).
  const now = at("2026-03-08T07:05:00Z");
  const lastCheck = at("2026-03-07T07:30:00Z"); // ran yesterday
  expect(isTimesDue(["02:30"], "America/New_York", lastCheck, now)).toBe(true);
  // ...and not due again an instant later.
  expect(isTimesDue(["02:30"], "America/New_York", at("2026-03-08T07:00:00Z"), now)).toBe(false);
});

test("nominalPeriodSec ignores the zone (times are wall clock)", () => {
  // The gap between clock times is zone-independent — a times-of-day monitor's
  // nominal period never changes when its timezone does.
  expect(nominalPeriodSec(["01:00", "23:00"])).toBe(22 * 3600);
});

test("hasTimeAt detects a duplicate, ignoring the entry being edited", () => {
  const times = ["09:00", "10:00", "11:00"];
  // Editing index 2 to "09:00" collides with index 0.
  expect(hasTimeAt(times, "09:00", 2)).toBe(true);
  // Editing an entry to its OWN value is not a duplicate.
  expect(hasTimeAt(times, "11:00", 2)).toBe(false);
  // A value nobody uses is fine.
  expect(hasTimeAt(times, "12:00", 2)).toBe(false);
  // Without an index, any occurrence counts (used when adding).
  expect(hasTimeAt(times, "09:00")).toBe(true);
  expect(hasTimeAt(times, "12:00")).toBe(false);
  expect(hasTimeAt([], "09:00")).toBe(false);
});

test("a duplicate can never reach storage, so the list stays unique", () => {
  // parseTimes is the storage boundary and is the reason a UI duplicate is
  // worse than a no-op: it silently drops the entry on save.
  expect(parseTimes("09:00,09:00,10:00")).toEqual(["09:00", "10:00"]);
});
