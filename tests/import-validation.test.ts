// One shared monitor-URL rule for create, edit and import. Import once
// accepted anything (e.g. "file:///etc/passwd") while create did not.
// Internal hosts (localhost, LAN) are allowed by design — see the README
// trust model — so only the scheme is enforced.
import { expect, test } from "bun:test";
import {
  monitorUrlSchema,
  scheduleError,
  scheduleTimesSchema,
  timezoneSchema,
} from "@/lib/validation";

const ok = [
  "https://example.com",
  "http://a.b/c",
  "https://1.2.3.4:8080/x",
  "http://localhost:3000/health",
  "http://grafana:3000/api/health",
  "http://192.168.1.10/",
  "http://[::1]/",
];
const bad = ["file:///etc/passwd", "not a url", "ftp://x.com", "javascript:alert(1)"];

for (const v of ok) test(`accepts ${v}`, () => expect(monitorUrlSchema.safeParse(v).success).toBe(true));
for (const v of bad) test(`rejects ${v}`, () => expect(monitorUrlSchema.safeParse(v).success).toBe(false));

test("trims surrounding whitespace", () => {
  expect(monitorUrlSchema.parse("  https://example.com  ")).toBe("https://example.com");
});

// The times/timezone pairing is enforced at every boundary that can create a
// times monitor (create, patch, import), so a monitor that would never run —
// or would run in the wrong zone — can't be persisted.
test("scheduleError rejects a times monitor with no times or no zone", () => {
  expect(scheduleError({ scheduleMode: "times", scheduleTimes: null, timezone: "Asia/Manila" })).toMatch(/time/i);
  expect(scheduleError({ scheduleMode: "times", scheduleTimes: "13:00", timezone: null })).toMatch(/timezone/i);
  expect(scheduleError({ scheduleMode: "times", scheduleTimes: "13:00", timezone: "Asia/Manila" })).toBeNull();
});

test("scheduleError leaves an interval monitor alone", () => {
  // An interval monitor has no times or zone by design, so neither is an error.
  expect(scheduleError({ scheduleMode: "interval", scheduleTimes: null, timezone: null })).toBeNull();
  // A patch that does not mention the mode must not be forced to resend them.
  expect(scheduleError({})).toBeNull();
});

test("scheduleTimesSchema normalises and rejects an empty list", () => {
  expect(scheduleTimesSchema.parse("13:00,03:00")).toBe("03:00,13:00");
  expect(scheduleTimesSchema.safeParse("").success).toBe(false);
  expect(scheduleTimesSchema.safeParse("nonsense").success).toBe(false);
});

test("timezoneSchema accepts real zones and rejects invented ones", () => {
  expect(timezoneSchema.safeParse("Asia/Manila").success).toBe(true);
  expect(timezoneSchema.safeParse("America/New_York").success).toBe(true);
  expect(timezoneSchema.safeParse("Mars/Olympus_Mons").success).toBe(false);
  expect(timezoneSchema.safeParse("").success).toBe(false);
});
