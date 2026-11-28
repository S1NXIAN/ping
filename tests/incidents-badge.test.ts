// The incidents badge counts what still needs attention: every ongoing
// incident (unresolved and not paused) plus every paused or closed incident
// newer than the last time the sheet was opened. Expected values come from
// worked examples.
import { expect, test } from "bun:test";
import {
  downSinceByMonitor,
  newestIncidentStart,
  ongoingIncidentCount,
  unseenIncidentCount,
} from "@/hooks/use-incidents";
import type { IncidentDTO, IncidentState } from "@/lib/ping-types";

function inc(startedAt: string, state: IncidentState, endedAt: string | null = null): IncidentDTO {
  return { monitorId: "m", monitorName: "svc", startedAt, endedAt, state };
}

const HOUR = 3_600_000;
const t0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();

test("an ongoing incident counts no matter how old it is", () => {
  // Started before the watermark; must still count because it never resolved.
  expect(unseenIncidentCount([inc(iso(-5 * HOUR), "ongoing")], t0)).toBe(1);
});

test("a resolved incident counts only until it has been seen", () => {
  const closed = inc(iso(-HOUR), "resolved", iso(-HOUR + 60_000));
  expect(unseenIncidentCount([closed], t0 - 2 * HOUR)).toBe(1); // unseen
  expect(unseenIncidentCount([closed], t0)).toBe(0); // seen
});

test("a paused incident clears once seen, like a closed one", () => {
  const paused = inc(iso(-5 * HOUR), "paused");
  expect(unseenIncidentCount([paused], t0 - 6 * HOUR)).toBe(1); // unseen
  expect(unseenIncidentCount([paused], t0)).toBe(0); // seen, no check left to close it
});

test("the count mixes ongoing and unseen settled incidents", () => {
  const incidents = [
    inc(iso(-5 * HOUR), "ongoing"), // ongoing, always counts
    inc(iso(-HOUR), "resolved", iso(-HOUR + 60_000)), // unseen resolved
    inc(iso(-2 * HOUR), "no-recovery", iso(-2 * HOUR)), // seen no-recovery
  ];
  expect(unseenIncidentCount(incidents, t0 - 90 * 60_000)).toBe(2);
});

test("the watermark is the newest start in the list", () => {
  expect(newestIncidentStart([])).toBe(0);
  expect(
    newestIncidentStart([inc(iso(-2 * HOUR), "ongoing"), inc(iso(-HOUR), "ongoing")]),
  ).toBe(t0 - HOUR);
});

test("only ongoing incidents are counted as ongoing", () => {
  const incidents = [
    inc(iso(-HOUR), "ongoing"),
    inc(iso(-2 * HOUR), "paused"),
    inc(iso(-3 * HOUR), "resolved", iso(-3 * HOUR + 60_000)),
    inc(iso(-4 * HOUR), "no-recovery", iso(-4 * HOUR)),
  ];
  expect(ongoingIncidentCount(incidents)).toBe(1);
});

test("down-since names only the ongoing incident's first failed check", () => {
  const incidents: IncidentDTO[] = [
    { ...inc(iso(-6 * HOUR), "ongoing"), monitorId: "a" },
    { ...inc(iso(-5 * HOUR), "paused"), monitorId: "b" },
    { ...inc(iso(-4 * HOUR), "ongoing"), monitorId: "c" },
    { ...inc(iso(-3 * HOUR), "ongoing"), monitorId: "a" },
  ];
  const map = downSinceByMonitor(incidents);
  expect(map.get("a")).toBe(iso(-6 * HOUR)); // the first ongoing, not the newer duplicate
  expect(map.get("c")).toBe(iso(-4 * HOUR));
  expect(map.has("b")).toBe(false); // paused is never a down-since claim
});
