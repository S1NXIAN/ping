"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/ping-client";
import type { IncidentDTO } from "@/lib/ping-types";

/** Per-device watermark: the newest incident start the operator has seen. */
const SEEN_STORAGE_KEY = "ping.incidents.seen";

/**
 * Lists incidents for one Scope (see GLOSSARY.md "Scope"): the whole Fleet
 * when `folderId` is null, else that Folder's monitors. The server scopes
 * before the list cap, so the badge and the sheet never undercount.
 */
async function fetchIncidents(folderId: string | null): Promise<IncidentDTO[]> {
  const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  const r = await api<{ incidents: IncidentDTO[] }>(`/api/incidents${qs}`);
  return r.incidents;
}

const byOngoing = (i: IncidentDTO): boolean => i.state === "ongoing";

/** The newest incident start in a loaded list, as epoch ms (0 for an empty
 *  list). Opening the sheet records this, so the badge clears. */
export function newestIncidentStart(incidents: IncidentDTO[]): number {
  return incidents.reduce((max, i) => Math.max(max, Date.parse(i.startedAt)), 0);
}

/** Every ongoing incident: each one is a real current failure. */
export function ongoingIncidentCount(incidents: IncidentDTO[]): number {
  return incidents.filter(byOngoing).length;
}

/**
 * The incidents badge count: every ongoing incident (unresolved, so it keeps
 * asking for attention) plus every paused or closed incident that started after
 * the last time the sheet was opened (`seenStartedAt`). A paused monitor's open
 * incident has no check left to close it, so it clears like viewed history
 * instead of asking forever.
 */
export function unseenIncidentCount(
  incidents: IncidentDTO[],
  seenStartedAt: number,
): number {
  return incidents.filter((i) => byOngoing(i) || Date.parse(i.startedAt) > seenStartedAt)
    .length;
}

/** The ONGOING incident's real first failed check per monitor. A paused open
 *  incident is never a "down since" claim. */
export function downSinceByMonitor(incidents: IncidentDTO[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const inc of incidents) {
    if (byOngoing(inc) && !map.has(inc.monitorId)) map.set(inc.monitorId, inc.startedAt);
  }
  return map;
}

/**
 * The dashboard's single source of Incident state for one Scope: the loaded
 * list, the per-device seen watermark, and the projections the badge and cards
 * read. A list tagged with another Folder is never shown, so a Folder switch
 * (or a failed scoped fetch) can never leak another Scope's count.
 */
export function useIncidents(
  folderId: string | null,
  /** The overview data this hook follows; incidents load once it arrives. */
  overview: unknown,
) {
  const [incidentData, setIncidentData] = useState<{
    folderId: string | null;
    list: IncidentDTO[];
  } | null>(null);
  // Tagged with its Folder like the list, so a previous Scope's error never
  // renders over this Scope's incidents.
  const [errorData, setErrorData] = useState<{
    folderId: string | null;
    message: string;
  } | null>(null);
  // In-flight guard plus a request tag: a slow response from the previous Scope
  // must not land after a switch.
  const request = useRef(0);

  const loadIncidents = useCallback(async () => {
    const tag = ++request.current;
    try {
      const list = await fetchIncidents(folderId);
      if (tag !== request.current) return;
      setIncidentData({ folderId, list });
      setErrorData(null);
    } catch (e) {
      if (tag !== request.current) return;
      // Keep the previous list; the badge shows nothing for this Scope until
      // a load succeeds, never another Folder's count.
      setErrorData({
        folderId,
        message: e instanceof Error ? e.message : "Failed to load incidents",
      });
    }
  }, [folderId]);

  useEffect(() => {
    if (overview) void loadIncidents();
  }, [loadIncidents, overview]);

  const incidents = incidentData?.folderId === folderId ? incidentData.list : null;
  const error = errorData?.folderId === folderId ? errorData.message : null;

  const [seenIncidentsAt, setSeenIncidentsAt] = useState(0);
  const seenRef = useRef(0);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SEEN_STORAGE_KEY)) || 0;
      seenRef.current = v;
      setSeenIncidentsAt(v);
    } catch {
      /* private browsing etc. */
    }
  }, []);

  const markViewed = useCallback((list: IncidentDTO[]) => {
    const newest = newestIncidentStart(list);
    if (newest <= seenRef.current) return;
    seenRef.current = newest;
    setSeenIncidentsAt(newest);
    try {
      localStorage.setItem(SEEN_STORAGE_KEY, String(newest));
    } catch {
      /* ignore */
    }
  }, []);

  const unseenCount = incidents ? unseenIncidentCount(incidents, seenIncidentsAt) : 0;
  const ongoingCount = incidents ? ongoingIncidentCount(incidents) : 0;
  const downSince = useMemo(() => downSinceByMonitor(incidents ?? []), [incidents]);

  return {
    incidents,
    error,
    unseenCount,
    ongoingCount,
    downSince,
    markViewed,
    refresh: loadIncidents,
  };
}

