// The maintenance module is pure: window classification and the countdown are
// testable without a database, a clock or a server. Expected strings are the
// canonical forms from the approved design — floor-based compound, never a
// rounded "2h left" that would overstate the time (GLOSSARY.md "Maintenance
// window": checks keep running, alerts are silenced).
import { expect, test } from "bun:test";
import { windowCountdown, windowState } from "@/lib/maintenance";

const MIN = 60_000;
// A 3-hour window from 10:00, fixed in UTC so nothing depends on wall time.
const START = Date.UTC(2026, 0, 1, 10, 0, 0);
const END = START + 180 * MIN;
const w = {
  startsAt: new Date(START).toISOString(),
  endsAt: new Date(END).toISOString(),
};

test("windowState is upcoming before the start instant", () => {
  expect(windowState(w, START - 30 * MIN)).toBe("upcoming");
});

test("windowState is active at the start instant", () => {
  expect(windowState(w, START)).toBe("active");
});

test("windowState is active mid-window", () => {
  expect(windowState(w, START + 30 * MIN)).toBe("active");
});

test("windowState is ended at the end instant", () => {
  expect(windowState(w, END)).toBe("ended");
});

test("windowState is ended after the window", () => {
  expect(windowState(w, END + MIN)).toBe("ended");
});

test("windowCountdown floors to a compound form for an active window", () => {
  // 5436s = 1h 30m 36s left — the 36s is dropped, never rounded up to "2h".
  expect(windowCountdown(w, END - 5436_000)).toBe("1h 30m left");
});

test("windowCountdown shows whole minutes under an hour", () => {
  expect(windowCountdown(w, END - 1800_000)).toBe("30m left");
});

test("windowCountdown shows sub-minute as <1m", () => {
  expect(windowCountdown(w, END - 45_000)).toBe("<1m left");
});

test("windowCountdown carries days for a long active window", () => {
  const longEnd = START + (2 * 24 + 3) * 3600_000;
  const long = { startsAt: w.startsAt, endsAt: new Date(longEnd).toISOString() };
  expect(windowCountdown(long, START)).toBe("2d 3h left");
});

test("windowCountdown says starts-in for an upcoming window", () => {
  expect(windowCountdown(w, START - 90 * MIN)).toBe("starts in 1h 30m");
});

test("windowCountdown is null once the window has ended", () => {
  expect(windowCountdown(w, END)).toBeNull();
});
