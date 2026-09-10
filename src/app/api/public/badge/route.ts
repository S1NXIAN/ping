import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { collectMonitorStats, isDegraded } from "@/lib/ping-stats";

/**
 * Public shields.io-style status badge — NO session required, gated by the
 * unguessable status-page token. Returns an SVG (image/svg+xml) that can be
 * embedded in READMEs:
 *
 *   ![ping](https://host/api/public/badge?token=…)
 *
 * Query params:
 *   token   required — the public status-page token (same one as /?status=…)
 *   label   left text, default "ping" (max 24 chars)
 *   monitor case-insensitive monitor name → badge for that one monitor only
 *   style   "flat" (default) | "flat-square" (sharp corners)
 *   uptime  "24h" | "7d" | "30d" — show the real uptime % for that window
 *           instead of the status word (null data stays honest: "no data")
 *
 * Invalid/missing/disabled token → an identical gray "not found" badge for
 * every failure mode (reveals nothing). Colors match PING's tokens: up
 * emerald, degraded amber, down rose, paused blue-gray, no data neutral.
 */

const MAX_CACHE = 60; // seconds — a badge going stale for a minute is fine

interface BadgeSpec {
  label: string;
  text: string;
  color: string;
}

/** Rough Verdana-11px advance width — same heuristic shields.io uses. */
function textWidth(s: string): number {
  return Math.max(s.length, 2) * 6.6 + 10;
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderBadge({ label, text, color }: BadgeSpec, square: boolean): string {
  const lw = Math.round(textWidth(label));
  const vw = Math.round(textWidth(text));
  const w = lw + vw;
  const rx = square ? 0 : 3;
  const title = `${label}: ${text}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" viewBox="0 0 ${w} 20" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>` +
    `<linearGradient id="s" x1="0" x2="0" y1="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity=".12"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity=".14"/>` +
    `</linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="${rx}" ry="${rx}" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${lw}" height="20" fill="#4c5565"/>` +
    `<rect x="${lw}" width="${vw}" height="20" fill="${color}"/>` +
    `<rect width="${w}" height="20" fill="url(#s)"/>` +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" font-weight="500">` +
    `<text x="${lw / 2}" y="15">${esc(label)}</text>` +
    `<text x="${lw + vw / 2}" y="15">${esc(text)}</text>` +
    `</g>` +
    `</svg>`
  );
}

function svgResponse(svg: string): NextResponse {
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${MAX_CACHE}, stale-while-revalidate=300`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const NOT_FOUND: BadgeSpec = { label: "ping", text: "not found", color: "#6e7581" };

interface BadgeMonitor {
  enabled: boolean;
  lastStatus: string | null;
  lastResponseMs: number | null;
  slowThresholdMs: number | null;
}

/** Honest aggregate of the visible (or selected) monitors into badge text. */
function badgeState(rows: BadgeMonitor[], label: string, single: boolean): BadgeSpec {
  if (rows.length === 0) {
    return { label, text: "no data", color: "#6e7581" };
  }
  const anyDown = rows.some((m) => m.enabled && m.lastStatus === "down");
  if (anyDown) return { label, text: "down", color: "#f43f5e" };

  const anyDegraded = rows.some((m) => m.enabled && isDegraded(m));
  if (anyDegraded) return { label, text: "degraded", color: "#f59e0b" };

  const allPaused = rows.every((m) => !m.enabled);
  if (allPaused) return { label, text: "paused", color: "#546a9e" };

  const noneChecked = rows.every((m) => m.lastStatus == null);
  if (noneChecked) return { label, text: single ? "pending" : "no data", color: "#6e7581" };

  // At least one monitor is up; none down, none degraded, not all paused.
  return { label, text: "operational", color: "#10b981" };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const token = q.get("token") ?? "";
  const settings = await db.settings.findUnique({ where: { id: "main" } });

  const valid =
    !!settings?.statusToken &&
    token.length === settings.statusToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(settings.statusToken));

  if (!valid) {
    // One gray badge for every failure mode — reveals nothing.
    return svgResponse(renderBadge(NOT_FOUND, q.get("style") === "flat-square"));
  }

  const label = (q.get("label") ?? "ping").slice(0, 24) || "ping";
  const square = q.get("style") === "flat-square";
  const monitorName = q.get("monitor");

  const monitors = await db.monitor.findMany({
    where: { statusHidden: false },
    select: {
      id: true,
      name: true,
      enabled: true,
      lastStatus: true,
      lastResponseMs: true,
      slowThresholdMs: true,
    },
  });

  // Optional: single-monitor badge, matched by name (case-insensitive).
  let rows = monitors;
  if (monitorName) {
    rows = monitors.filter((m) => m.name.toLowerCase() === monitorName.toLowerCase());
    if (rows.length === 0) {
      return svgResponse(
        renderBadge({ label, text: "no such monitor", color: "#6e7581" }, square),
      );
    }
  }

  // Optional: uptime-% mode — the average of REAL recorded checks only.
  const uptimeWindow = q.get("uptime");
  if (uptimeWindow === "24h" || uptimeWindow === "7d" || uptimeWindow === "30d") {
    const bundle = await collectMonitorStats();
    const fractions = rows
      .map((m) => {
        const s = bundle.statsByMonitor.get(m.id);
        return uptimeWindow === "24h"
          ? s?.uptime24h
          : uptimeWindow === "7d"
            ? s?.uptime7d
            : s?.uptime30d;
      })
      .filter((v): v is number => v != null);
    if (fractions.length === 0) {
      return svgResponse(renderBadge({ label, text: "no data", color: "#6e7581" }, square));
    }
    const avg = fractions.reduce((a, b) => a + b, 0) / fractions.length;
    const pct = (avg * 100).toFixed(avg < 0.99995 ? 2 : 0);
    return svgResponse(
      renderBadge({ label, text: `${pct}% · ${uptimeWindow}`, color: "#8b5cf6" }, square),
    );
  }

  // Status mode — the honest aggregate.
  return svgResponse(renderBadge(badgeState(rows, label, rows.length === 1), square));
}
