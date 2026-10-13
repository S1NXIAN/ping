// The incidents badge counts what still needs attention: every ongoing
// incident (unresolved) plus every closed incident newer than the last time
// the sheet was opened. Expected values come from worked examples.
import { expect, test } from "bun:test";
import { newestIncidentStart, unseenIncidentCount } from "@/lib/ping-client";
import type { AdminIncidentDTO } from "@/lib/ping-types";

function inc(startedAt: string, endedAt: string | null): AdminIncidentDTO {
  return {
    monitorId: "m",
    monitorName: "svc",
    startedAt,
    endedAt,
    downChecks: 1,
    lastStatusCode: 503,
    noteId: null,
    note: null,
  };
}

const HOUR = 3_600_000;
const t0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();

test("an ongoing incident counts no matter how old it is", () => {
  // Started before the watermark; must still count because it never resolved.
  const incidents = [inc(iso(-5 * HOUR), null)];
  expect(unseenIncidentCount(incidents, t0)).toBe(1);
});

test("a closed incident counts only until it has been seen", () => {
  const closed = inc(iso(-HOUR), iso(-HOUR + 60_000));
  expect(unseenIncidentCount([closed], t0 - 2 * HOUR)).toBe(1); // unseen
  expect(unseenIncidentCount([closed], t0)).toBe(0); // seen
});

test("the count mixes ongoing and unseen closed incidents", () => {
  const incidents = [
    inc(iso(-5 * HOUR), null), // ongoing, always counts
    inc(iso(-HOUR), iso(-HOUR + 60_000)), // unseen closed
    inc(iso(-2 * HOUR), iso(-2 * HOUR + 60_000)), // seen closed
  ];
  expect(unseenIncidentCount(incidents, t0 - 90 * 60_000)).toBe(2);
});

test("the watermark is the newest start in the list", () => {
  expect(newestIncidentStart([])).toBe(0);
  expect(newestIncidentStart([inc(iso(-2 * HOUR), null), inc(iso(-HOUR), null)])).toBe(
    t0 - HOUR,
  );
});
