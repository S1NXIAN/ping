// The incidents badge counts unread incidents: everything that started after
// the last time the sheet was CLOSED. The sheet shows that same set as its
// "New" group, so the number and the list can never disagree. Expected values
// come from worked examples.
import { expect, test } from "bun:test";
import {
  downSinceByMonitor,
  groupIncidents,
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

test("an ongoing incident counts only while it is unread", () => {
  // Started before the watermark: already seen, so the header's down count,
  // the card and the tab title carry it — the badge does not.
  expect(unseenIncidentCount([inc(iso(-5 * HOUR), "ongoing")], t0)).toBe(0);
  // Started after the watermark: new to the operator.
  expect(unseenIncidentCount([inc(iso(-5 * HOUR), "ongoing")], t0 - 6 * HOUR)).toBe(1);
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

test("only incidents that started after the watermark count", () => {
  const incidents = [
    inc(iso(-5 * HOUR), "ongoing"), // seen, and still open
    inc(iso(-HOUR), "resolved", iso(-HOUR + 60_000)), // unseen
    inc(iso(-2 * HOUR), "no-recovery", iso(-2 * HOUR)), // seen
  ];
  expect(unseenIncidentCount(incidents, t0 - 90 * 60_000)).toBe(1);
});

test("the sheet groups new, then seen-ongoing, then the rest", () => {
  const incidents = [
    inc(iso(-6 * HOUR), "ongoing"), // seen, still open
    inc(iso(-5 * HOUR), "resolved", iso(-5 * HOUR + 60_000)), // seen
    inc(iso(-3 * HOUR), "ongoing"), // unseen
    inc(iso(-2 * HOUR), "paused"), // unseen, no check left to close it
    inc(iso(-HOUR), "resolved", iso(-HOUR + 60_000)), // unseen
  ];
  const groups = groupIncidents(incidents, t0 - 4 * HOUR);

  expect(groups.unseen.map((i) => i.startedAt)).toEqual([
    iso(-HOUR),
    iso(-2 * HOUR),
    iso(-3 * HOUR),
  ]);
  expect(groups.ongoing.map((i) => i.startedAt)).toEqual([iso(-6 * HOUR)]);
  expect(groups.earlier.map((i) => i.startedAt)).toEqual([iso(-5 * HOUR)]);
  // The badge and the "New" group are the same set, by construction.
  expect(unseenIncidentCount(incidents, t0 - 4 * HOUR)).toBe(groups.unseen.length);
});

test("grouping an empty or fully-seen list leaves no new rows", () => {
  expect(groupIncidents([], t0)).toEqual({ unseen: [], ongoing: [], earlier: [] });
  const seen = [inc(iso(-2 * HOUR), "ongoing"), inc(iso(-HOUR), "resolved", iso(-HOUR))];
  const groups = groupIncidents(seen, t0);
  expect(groups.unseen).toEqual([]);
  expect(groups.ongoing).toHaveLength(1);
  expect(groups.earlier).toHaveLength(1);
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
