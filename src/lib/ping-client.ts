// Small client-side helpers for PING: fetch wrapper + formatters.
import type { AdminIncidentDTO } from "./ping-types";
import { isOngoingIncident } from "./incident-status";

/** Check-interval bounds, shared with the API schemas (see lib/validation.ts).
 *  Seconds are not a unit: the scheduler wakes every 30s, so anything finer
 *  could not be honoured exactly. The floor is 3 minutes; the ceiling is 10
 *  minutes. 15 minutes is the free tier's idle spin-down — a monitor set there
 *  would let the service cold-boot, which defeats the point of PING. */
export const INTERVAL_MIN_SEC = 180;
export const INTERVAL_MAX_SEC = 600;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Lists incidents for one Scope (see GLOSSARY.md "Scope"): the whole Fleet
 * when `folderId` is null, else that Folder's monitors. The server scopes
 * before the list cap, so the badge and the sheet never undercount.
 */
export async function fetchIncidents(folderId: string | null): Promise<AdminIncidentDTO[]> {
  const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  const r = await api<{ incidents: AdminIncidentDTO[] }>(`/api/incidents${qs}`);
  return r.incidents;
}

/** The newest incident start in a loaded list, as epoch ms (0 for an empty
 *  list). The sheet records this when opened, so the badge clears. */
export function newestIncidentStart(incidents: AdminIncidentDTO[]): number {
  return incidents.reduce((max, i) => Math.max(max, Date.parse(i.startedAt)), 0);
}

/**
 * The incidents badge count: every ongoing incident (unresolved, so it keeps
 * asking for attention) plus every paused or closed incident that started after
 * the last time the sheet was opened (`seenStartedAt`). A paused monitor's open
 * incident has no check left to close it, so it clears like viewed history
 * instead of asking forever. Opening the sheet moves `seenStartedAt` to the
 * newest start it listed.
 */
export function unseenIncidentCount(
  incidents: AdminIncidentDTO[],
  seenStartedAt: number,
): number {
  return incidents.filter(
    (i) => isOngoingIncident(i) || Date.parse(i.startedAt) > seenStartedAt,
  ).length;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Headers, not an object spread: HeadersInit may be an array of pairs or a
  // Headers instance, and spreading those into an object would produce index
  // keys and silently drop the caller's headers.
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : undefined) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

/** "https://api.example.com/x" -> "api.example.com" */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Relative time like "just now", "4m ago", "3h ago", "2d ago" */
export function timeAgo(iso: string | null | undefined, now?: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.floor(((now ?? Date.now()) - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/** 1234 -> "1.23 s", 456 -> "456 ms" */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Uptime band -> status ink, shared by every surface that shows an uptime
 * percentage (dashboard stat, detail sheet). Bands match the
 * formatter's rounding so ink and glyph never disagree: values that display
 * as "100%" (>= 99.995%) are up, 90–99.99% warn, below 90% down. Null stays
 * null — unknown must never read as healthy.
 */
export function uptimeTone(
  fraction: number | null | undefined,
): "up" | "warn" | "down" | null {
  if (fraction == null || Number.isNaN(fraction)) return null;
  const pct = fraction * 100;
  if (pct >= 99.995) return "up";
  if (pct >= 90) return "warn";
  return "down";
}

/**
 * Uptime band -> ink class. One source for every surface that shows an
 * uptime percentage; no-data stays quiet muted (unknown must never read as
 * healthy).
 */
export function uptimeToneClass(tone: ReturnType<typeof uptimeTone>): string {
  if (tone === "up") return "text-up";
  if (tone === "warn") return "text-warn";
  if (tone === "down") return "text-down";
  return "text-muted-foreground";
}

/** 0.9982 -> "99.8%" (null -> "—") */
export function formatUptime(fraction: number | null | undefined): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  const pct = fraction * 100;
  if (pct >= 99.995) return "100%";
  return `${pct.toFixed(pct >= 99 ? 2 : 1)}%`;
}

/** 180 -> "3m", 600 -> "10m". Every interval written through the API is whole minutes. */
export function formatInterval(seconds: number): string {
  return `${seconds / 60}m`;
}

/** A duration as a person reads it: "45s", "10m", "3h 5m", "1d 1h".
 *  `coarse` drops the seconds unit and pads the minutes ("<1m", "3h 05m") —
 *  the outage reading the card and the incidents sheet share, so one outage
 *  never reads two ways. The two surfaces used to carry near-copy formatters. */
export function formatDuration(seconds: number, { coarse = false } = {}): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const mm = coarse ? String(m).padStart(2, "0") : String(m);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  if (m > 0) return `${m}m`;
  if (coarse) return "<1m";
  return `${Math.floor(seconds)}s`;
}

/** Normalizes user-typed URLs: adds https:// when scheme missing. */
export function normalizeUrl(input: string): string | null {
  let candidate = input.trim();
  if (!candidate) return null;
  // Only prepend when there is no explicit `scheme://` — otherwise a
  // non-http scheme (ftp://, file://) would be mangled into a bogus https
  // host instead of being rejected below.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) candidate = `https://${candidate}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Formats an ISO string as a compact local date-time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
