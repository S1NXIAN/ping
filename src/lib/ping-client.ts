// Small client-side helpers for PING: fetch wrapper + formatters.

/** Check-interval bounds, shared with the API schemas (see lib/validation.ts).
 *  The floor is 60s and seconds are not a grammar unit: the scheduler wakes
 *  every 30s, so anything finer could not be honoured exactly — and showing a
 *  cadence we can't keep would break the no-invented-numbers contract. The top
 *  unit is the hour; the ceiling is 24 of them. */
export const INTERVAL_MIN_SEC = 60;
export const INTERVAL_MAX_SEC = 86400; // 24 hours

const INTERVAL_UNIT_SEC: Record<string, number> = { h: 3600, m: 60 };

const INTERVAL_SYNTAX_ERROR = "Use a number and unit, e.g. 4M or 4H30M";

/**
 * Parses a custom check interval such as `4M`, `90M` or `4H30M`.
 * Units are H/M, case-insensitive, separated by `:`, spaces or nothing.
 * Units are unbounded (90M is valid) — only the summed total is range-checked.
 * Returns total seconds, the unit the API, DB and scheduler already use.
 */
export function parseInterval(input: string): { seconds: number } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Enter an interval, e.g. 4M or 4H30M" };

  // Split on separators. Runs of `:`/whitespace collapse, so a doubled
  // separator ("4M::5H") is tolerated; a leading/trailing one leaves an empty
  // part and is rejected.
  const parts = raw.split(/[:\s]+/);
  if (parts.some((p) => !p)) return { error: INTERVAL_SYNTAX_ERROR };

  const seen = new Set<string>();
  let total = 0;
  for (const part of parts) {
    // Each part is one or more <int><unit> groups ("3D15M" and "4M" both ok).
    const groups = part.match(/\d+[a-zA-Z]+/g);
    if (!groups || groups.join("") !== part) return { error: INTERVAL_SYNTAX_ERROR };
    for (const group of groups) {
      const match = group.match(/^(\d+)([a-zA-Z]+)$/)!;
      const amount = Number(match[1]);
      const unit = match[2].toLowerCase();
      // Own keys only: `unit in MAP` walks the prototype chain, so
      // "constructor"/"toString" would pass and yield NaN.
      if (!Object.hasOwn(INTERVAL_UNIT_SEC, unit))
        return {
          error:
            unit === "s"
              ? "Seconds aren't supported — checks run on a 30s scheduler. Try 1M."
              : `Unknown unit "${match[2]}" — use H or M`,
        };
      if (seen.has(unit)) return { error: `"${unit.toUpperCase()}" is given twice` };
      seen.add(unit);
      total += amount * INTERVAL_UNIT_SEC[unit];
    }
  }

  if (total < INTERVAL_MIN_SEC) return { error: `At least ${INTERVAL_MIN_SEC / 60}M` };
  if (total > INTERVAL_MAX_SEC)
    return { error: `At most ${INTERVAL_MAX_SEC / 3600} hours` };
  return { seconds: total };
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

/** 300 -> "5m", 3600 -> "1h", 16200 -> "4h 30m".
 *  Zero-skipping compound, hours as the top unit: only the units present are
 *  shown. A legacy value past 24h still reads truthfully (e.g. "48h"). */
export function formatInterval(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  // `s` never comes from the grammar (the scheduler can't honour it) but a
  // legacy/API-supplied value must still render truthfully.
  if (s) parts.push(`${s}s`);
  return parts.length ? parts.join(" ") : "0s";
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
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
