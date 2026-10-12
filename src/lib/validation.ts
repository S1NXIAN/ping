// Shared input validation. The monitor-URL rule lives here so create, edit
// and import all reject the same values — import once accepted anything
// (e.g. "file:///etc/passwd") while the create route did not.
//
// Only the scheme is checked: monitor URLs may point at internal hosts
// (localhost, LAN names, link-local) by design — see the trust model in the
// README. The admin is already authenticated, so this is not untrusted input;
// blocking internal targets would break legitimate internal monitoring.
import { z } from "zod";
import { INTERVAL_MAX_SEC, INTERVAL_MIN_SEC } from "./ping-client";
import { parseTimes, IANA_TIMEZONES } from "./schedule";

/** A monitor URL: any http(s) URL, internal or public. */
export const monitorUrlSchema = z
  .string()
  .trim()
  .min(4, "URL is required")
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a valid http(s) URL");

/** Check interval in seconds. Bounded to the range the scheduler and the
 *  custom-interval grammar can honour (see INTERVAL_MIN_SEC / MAX_SEC). */
export const intervalSecSchema = z
  .number()
  .int()
  .min(INTERVAL_MIN_SEC, `At least ${INTERVAL_MIN_SEC / 60} minute`)
  .max(INTERVAL_MAX_SEC, `At most ${INTERVAL_MAX_SEC / 3600} hours`);

/** How a monitor's cadence is defined. */
export const scheduleModeSchema = z.enum(["interval", "times"]);

/** Every IANA zone this runtime can format in. Sourced from the one list in
 *  lib/schedule.ts so the editor, the picker and validation never drift. */
const IANA_ZONES = new Set(IANA_TIMEZONES);

/** True when the runtime can actually format in this zone. Tested by use
 *  rather than by list membership: resolvedOptions().timeZone can return an
 *  alias (e.g. Asia/Calcutta) that supportedValuesOf omits. */
function isUsableTimezone(tz: string): boolean {
  if (IANA_ZONES.has(tz)) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** An IANA timezone the runtime can actually format in. */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isUsableTimezone, "Unknown timezone");

/** Clock times as the CSV the column stores, e.g. "03:00,13:00". Rejects an
 *  empty list — a times-of-day monitor with no times would never run. */
export const scheduleTimesSchema = z
  .string()
  .trim()
  .min(1, "Add at least one time")
  .transform((v) => parseTimes(v).join(","))
  .refine((v) => v.length > 0, "Add at least one valid time (HH:MM)");

/** The three schedule fields, shared by create and patch so both accept the
 *  same shape. Times mode requires both a time list and a timezone. */
export const scheduleFields = {
  scheduleMode: scheduleModeSchema.optional(),
  scheduleTimes: scheduleTimesSchema.nullish(),
  timezone: timezoneSchema.nullish(),
};

/**
 * Cross-field check for a schedule update. Only enforced when the payload
 * actually sets times mode — a patch that leaves the mode alone must not be
 * forced to resend the times. Returns an error message, or null when fine.
 */
export function scheduleError(input: {
  scheduleMode?: "interval" | "times";
  scheduleTimes?: string | null;
  timezone?: string | null;
}): string | null {
  if (input.scheduleMode !== "times") return null;
  if (!input.scheduleTimes) return "Add at least one time";
  if (!input.timezone) return "Pick a timezone";
  return null;
}

/**
 * Cross-field check for the method/keyword pairing. A HEAD response has no
 * body, so a keyword check can never match and the monitor would record a
 * permanent false down. Enforced at every write boundary (create, patch,
 * import) instead of being silently coerced to GET in the checker. Evaluated
 * against the resulting state, so a patch that only switches the method still
 * validates against the keyword already stored. Returns a message, or null.
 */
export function methodKeywordError(input: {
  method?: "GET" | "HEAD";
  keyword?: string | null;
}): string | null {
  if (input.method !== "HEAD") return null;
  if (!input.keyword) return null;
  return "HEAD checks can't read the response body — use GET, or turn the keyword off.";
}
