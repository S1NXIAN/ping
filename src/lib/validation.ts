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
  .max(INTERVAL_MAX_SEC, `At most ${INTERVAL_MAX_SEC / 86400} days`);
