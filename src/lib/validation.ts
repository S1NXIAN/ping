// Shared input validation. The monitor-URL rule lives here so create, edit
// and import all reject the same values — import once accepted anything
// (e.g. "file:///etc/passwd") while the create route did not.
import { z } from "zod";

/** A monitor URL: http(s) with a dotted hostname (mirrors the create route). */
export const monitorUrlSchema = z
  .string()
  .trim()
  .min(4, "URL is required")
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Enter a valid http(s) URL");
