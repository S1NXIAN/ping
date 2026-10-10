// Times-of-day scheduling: a monitor that checks at fixed clock times every
// day, interpreted in its own IANA timezone.
//
// The times are stored as zero-padded "HH:MM" wall-clock strings in the
// monitor's own zone (never as instants) — so they survive a timezone change
// or a DST shift as the times the user actually typed. Turning a wall clock
// into an instant needs Intl: there is no arithmetic shortcut across a DST
// boundary, and doing it by hand silently breaks twice a year.

/** Max clock times per monitor — bounds the schedule and the tick work. */
export const MAX_SCHEDULE_TIMES = 12;

/** Every IANA zone this runtime knows. Built once — the list is static.
 *  Empty when the runtime lacks Intl.supportedValuesOf, so callers must treat
 *  an empty list as "no picker available" rather than "no valid zones". */
export const IANA_TIMEZONES: string[] = (() => {
  try {
    return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
})();

const MS_PER_MIN = 60_000;
const MIN_PER_DAY = 1440;

/** One or two sentence description of a timezone-independent instant. */
type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** The wall-clock parts of `ts` as seen in `timeZone`. */
function partsInZone(ts: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(new Date(ts))) {
    if (type !== "literal") p[type] = Number(value);
  }
  // Intl renders midnight as hour 24 in some locales/zones; normalise it.
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour === 24 ? 0 : p.hour,
    minute: p.minute,
    second: p.second,
  };
}

/** The zone's UTC offset at `ts`, in ms (local = UTC + offset). */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const p = partsInZone(ts, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Compare at whole-second resolution: formatToParts drops the ms.
  return asIfUtc - Math.floor(ts / 1000) * 1000;
}

/** True when `ts` really displays as this wall clock in the zone. */
function matchesWallClock(ts: number, y: number, mo: number, d: number, h: number, mi: number, timeZone: string): boolean {
  const p = partsInZone(ts, timeZone);
  return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi;
}

/**
 * A wall clock in `timeZone` -> the UTC instant it denotes.
 *
 * DST edges (both resolved by the same rule — "the earliest instant at or
 * after the requested wall clock"):
 *  - spring forward, the time does not exist (02:30 in New York): clocks jump
 *    01:59 -> 03:00, so 02:30 resolves to 03:00 — the moment the gap closes.
 *  - fall back, the time happens twice (01:30 in New York): both offsets are
 *    candidates and the earliest is chosen, so the check runs once, not twice.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Probe a day either side so both DST offsets are seen.
  const offsets = new Set<number>();
  for (const probe of [target - 86_400_000, target, target + 86_400_000]) {
    offsets.add(zoneOffsetMs(probe, timeZone));
  }
  const candidates = [...offsets].map((o) => target - o).sort((a, b) => a - b);

  const exact = candidates.filter((ts) => matchesWallClock(ts, year, month, day, hour, minute, timeZone));
  if (exact.length > 0) return exact[0]; // earliest = first occurrence on fall-back

  // Nonexistent local time (spring-forward gap): 01:59:59 jumps to 03:00, so
  // 02:30 never happens. "Skip forward" means the instant the gap closes —
  // 03:00 — not 02:30 shifted by an hour. The local clock is non-decreasing
  // across a gap, so bisect for the earliest instant that has reached target.
  const targetMinutes = target / MS_PER_MIN;
  let lo = target - 26 * 3_600_000;
  let hi = target + 26 * 3_600_000;
  if (localMinutes(lo, timeZone) >= targetMinutes) return lo;
  if (localMinutes(hi, timeZone) < targetMinutes) return candidates[candidates.length - 1];
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localMinutes(mid, timeZone) >= targetMinutes) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Minutes since the epoch *day* of `ts`, in the zone — a comparable wall clock. */
function localMinutes(ts: number, timeZone: string): number {
  const p = partsInZone(ts, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / MS_PER_MIN;
}

/** "HH:MM" -> minutes past local midnight. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** The local calendar date at `ts` in the zone, shifted by `dayOffset`. */
function localDateAt(ts: number, timeZone: string, dayOffset: number): [number, number, number] {
  const p = partsInZone(ts, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** Every instant for `times` on the local date at `ts` (+`dayOffset` days). */
function instantsOnLocalDay(times: string[], timeZone: string, ts: number, dayOffset: number): number[] {
  const [y, mo, d] = localDateAt(ts, timeZone, dayOffset);
  return times.map((t) => {
    const [h, m] = t.split(":").map(Number);
    return zonedWallClockToUtc(y, mo, d, h, m, timeZone);
  });
}

/**
 * The next instant strictly after `nowMs`, searching today then tomorrow.
 * Returns null when no times are configured.
 */
export function nextScheduledInstant(times: string[], timeZone: string, nowMs: number): number | null {
  if (times.length === 0) return null;
  const candidates = [
    ...instantsOnLocalDay(times, timeZone, nowMs, 0),
    ...instantsOnLocalDay(times, timeZone, nowMs, 1),
  ].sort((a, b) => a - b);
  return candidates.find((ts) => ts > nowMs) ?? null;
}

/**
 * The latest instant at or before `nowMs`, searching today then yesterday.
 * This is the scheduled instant a bounded catch-up would run. Null when no times.
 */
export function mostRecentScheduledInstant(times: string[], timeZone: string, nowMs: number): number | null {
  if (times.length === 0) return null;
  const candidates = [
    ...instantsOnLocalDay(times, timeZone, nowMs, 0),
    ...instantsOnLocalDay(times, timeZone, nowMs, -1),
  ].sort((a, b) => a - b);
  const past = candidates.filter((ts) => ts <= nowMs);
  return past.length > 0 ? past[past.length - 1] : null;
}

/**
 * Is a times-of-day monitor due at `nowMs`?
 *
 * Bounded catch-up: due when the most recent scheduled instant has passed and
 * the last check predates it. A wake after several missed scheduled instants
 * runs ONE check (the latest one), never a backlog — and a check already run
 * for that instant does not fire again.
 */
export function isTimesDue(
  times: string[],
  timeZone: string,
  lastCheckAtMs: number | null,
  nowMs: number,
): boolean {
  const latest = mostRecentScheduledInstant(times, timeZone, nowMs);
  if (latest == null) return false;
  if (lastCheckAtMs == null) return true; // never checked
  return lastCheckAtMs < latest;
}

/**
 * The period a times-of-day monitor is treated as having: its largest gap
 * between consecutive clock times. Used only to decide whether a gap in check
 * history means PING was asleep (incidents.ts) — a monitor with 1:00 PM and
 * 3:00 AM has a real 14h overnight gap, so the gap rule must scale to it.
 */
export function nominalPeriodSec(times: string[]): number {
  const mins = [...new Set(times.map(timeToMinutes))].sort((a, b) => a - b);
  if (mins.length <= 1) return MIN_PER_DAY * 60; // one time = once a day
  let largest = 0;
  for (let i = 1; i < mins.length; i++) largest = Math.max(largest, mins[i] - mins[i - 1]);
  // Wrap past midnight back to the first time of the next day.
  largest = Math.max(largest, MIN_PER_DAY - mins[mins.length - 1] + mins[0]);
  return largest * 60;
}

/**
 * Parses the stored CSV of clock times. Sorts, dedupes, drops malformed
 * entries and caps at MAX_SCHEDULE_TIMES. Returns [] for null/empty/invalid,
 * which callers read as "not a times-of-day monitor".
 */
export function parseTimes(input: string | null | undefined): string[] {
  if (!input) return [];
  const valid = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s));
  return [...new Set(valid)].sort().slice(0, MAX_SCHEDULE_TIMES);
}

/** Serialises clock times for storage; null when there are none. */
export function formatTimes(times: string[]): string | null {
  const clean = parseTimes(times.join(","));
  return clean.length > 0 ? clean.join(",") : null;
}

/** A human list of the times in the given zone: "1:00 PM, 3:00 AM". */
export function formatTimesForDisplay(times: string[], timeZone: string): string {
  return parseTimes(times.join(","))
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      // Build the instant via the zone so AM/PM matches the user's clock,
      // then read it back with a fixed locale — the label is zone-correct.
      const ts = zonedWallClockToUtc(2026, 1, 1, h, m, timeZone);
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(ts));
    })
    .join(", ");
}
