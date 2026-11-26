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

/** Max keyword length, shared by the schema below. A validation limit, so it
 *  lives with the other input rules rather than in the check engine. */
const KEYWORD_MAX_LENGTH = 200;

/** Keyword check: body must contain (or not contain) this string; null/absent
 *  = off. Shared by create, edit and import so all three reject the same
 *  values — an empty string is refused (clearing is done by sending null). */
export const keywordSchema = z
  .string()
  .trim()
  .min(1, "Keyword cannot be empty — clear the field to turn the check off")
  .max(KEYWORD_MAX_LENGTH, `Keyword is too long (${KEYWORD_MAX_LENGTH} chars max)`)
  .nullish();

/** Optional latency threshold in ms; null/absent = off. Shared by create,
 *  edit and import so the bounds cannot drift between the three boundaries. */
export const slowThresholdMsSchema = z
  .number()
  .int()
  .min(50, "Threshold must be at least 50 ms")
  .max(30000, "Threshold must be at most 30000 ms")
  .nullish();

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
  .min(INTERVAL_MIN_SEC, `At least ${INTERVAL_MIN_SEC / 60} minutes`)
  .max(INTERVAL_MAX_SEC, `At most ${INTERVAL_MAX_SEC / 60} minutes`)
  .multipleOf(60, "Use whole minutes");

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
