import type { AdminIncidentDTO } from "./ping-types";

/** The four states an incident row can be in. */
export type IncidentState = "ongoing" | "paused" | "no-recovery" | "resolved";

type IncidentShape = Pick<AdminIncidentDTO, "endedAt" | "recovered" | "monitorPaused">;

/** A paused monitor's open incident is not an ongoing outage. */
export function isOngoingIncident(inc: IncidentShape): boolean {
  return inc.endedAt == null && !inc.monitorPaused;
}

export function incidentState(inc: IncidentShape): IncidentState {
  if (inc.endedAt == null) return inc.monitorPaused ? "paused" : "ongoing";
  return inc.recovered ? "resolved" : "no-recovery";
}
