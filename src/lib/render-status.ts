// Live Render platform status, fetched from Render's public statuspage API.
// On any failure we report the failure honestly — never invented data.
import type { RenderStatusResponse } from "./ping-types";

const STATUS_URL = "https://status.render.com/api/v2/status.json";
const INCIDENTS_URL = "https://status.render.com/api/v2/incidents/unresolved.json";
const TTL_MS = 5 * 60_000;

let cache: { at: number; data: RenderStatusResponse } | null = null;

interface StatuspageStatus {
  status?: { indicator?: string; description?: string };
}

interface StatuspageIncident {
  name?: string;
  impact?: string;
  status?: string;
  shortlink?: string;
  created_at?: string;
  resolved_at?: string | null;
}

export async function getRenderStatus(force = false): Promise<RenderStatusResponse> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return cache.data;
  }
  const fetchedAt = new Date().toISOString();
  try {
    const [statusRes, incidentsRes] = await Promise.allSettled([
      fetch(STATUS_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      fetch(INCIDENTS_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
    ]);

    if (statusRes.status !== "fulfilled" || !statusRes.value.ok) {
      throw new Error(
        statusRes.status === "fulfilled"
          ? `status endpoint returned HTTP ${statusRes.value.status}`
          : "status endpoint unreachable",
      );
    }
    const statusJson = (await statusRes.value.json()) as StatuspageStatus;

    let incidents: StatuspageIncident[] = [];
    if (incidentsRes.status === "fulfilled" && incidentsRes.value.ok) {
      const json = (await incidentsRes.value.json().catch(() => null)) as
        | { incidents?: StatuspageIncident[] }
        | null;
      incidents = Array.isArray(json?.incidents) ? (json?.incidents ?? []) : [];
    }

    const indicatorRaw = statusJson.status?.indicator ?? "unknown";
    const data: RenderStatusResponse = {
      ok: true,
      indicator:
        indicatorRaw === "none" ||
        indicatorRaw === "minor" ||
        indicatorRaw === "major" ||
        indicatorRaw === "critical"
          ? indicatorRaw
          : "unknown",
      description: statusJson.status?.description ?? "Unknown",
      incidents: incidents.slice(0, 5).map((inc) => ({
        name: inc.name ?? "Unnamed incident",
        impact: inc.impact ?? "unknown",
        status: inc.status ?? "unknown",
        shortlink: inc.shortlink ?? "https://status.render.com",
        startedAt: inc.created_at ?? null,
        resolvedAt: inc.resolved_at ?? null,
      })),
      pageUrl: "https://status.render.com",
      fetchedAt,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    // Honest failure state — the UI will say we couldn't reach the page.
    return {
      ok: false,
      indicator: "unknown",
      description: "",
      incidents: [],
      pageUrl: "https://status.render.com",
      fetchedAt,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}
