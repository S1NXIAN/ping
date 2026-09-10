import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { isDegraded } from "@/lib/ping-stats";

/**
 * Dynamic Open-Graph share card (1200×630 PNG).
 *
 * Two modes:
 *  - /api/public/og?token=<valid status token> → live status card:
 *    monitor summary, 24h uptime (real checks only) and a 30-day bar strip.
 *  - /api/public/og (no or invalid token) → generic branded card, no data.
 *
 * Everything on the card is measured from the Check table — no invented
 * statistics. Short-lived cache so unfurls stay fresh without hammering
 * the database.
 */
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

// PING logo mark — the repo's logo.svg simplified to a single solid color
// (satori-safe: no gradient defs), embedded as a data URI.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect x="0" y="0" width="64" height="64" rx="0" fill="#ffffff"/><path d="M8 32 h11 l4 -15 l7 27 l5 -19 l4 7 h13" fill="none" stroke="#0b0c0e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="52" cy="32" r="3.4" fill="#0b0c0e"/></svg>`;
const LOGO = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;

// A wide heartbeat line for the generic card's lower area.
const PULSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 90" width="900" height="90"><path d="M0 60 h140 l14 -38 l24 66 l18 -48 l12 20 h200 l14 -38 l24 66 l18 -48 l12 20 h424" fill="none" stroke="#e6e8ec" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/></svg>`;
const PULSE = `data:image/svg+xml,${encodeURIComponent(PULSE_SVG)}`;

const COLORS = {
  bg: "#0b0c0e",
  card: "#121316",
  border: "#25272d",
  fg: "#e9ebee",
  muted: "#9aa0a8",
  dim: "#6d727b",
  up: "#10b981",
  down: "#f43f5e",
  warn: "#f59e0b",
  teal: "#e6e8ec", // white accent (kicker / today marker)
  violet: "#ffffff", // logo tile white (key name kept)
};

interface DayBar {
  up: number;
  down: number;
}

function agoLabel(iso: Date | null): string | null {
  if (!iso) return null;
  const s = Math.max(0, Math.floor((Date.now() - iso.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

function dayColor(bar: DayBar | undefined): string {
  if (!bar || bar.up + bar.down === 0) return "#232529"; // visible "no data" slate
  const ratio = bar.down / (bar.up + bar.down);
  if (ratio === 0) return COLORS.up;
  if (ratio <= 0.2) return COLORS.warn;
  return COLORS.down;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const settings = await db.settings.findUnique({
    where: { id: "main" },
    select: { statusToken: true, statusTitle: true },
  });

  const valid =
    !!settings?.statusToken &&
    token.length === settings.statusToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(settings.statusToken));

  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "").slice(0, 40);

  // ---- gather live status data (valid token only) ----
  let headline = "Uptime for Render Free";
  let headlineColor = COLORS.fg;
  let kicker = "PING · UPTIME MONITOR";
  let meta = "Real HTTP checks · honest history · runs free on Render";
  let bars: string[] | null = null;
  let barsCaption = "";

  if (valid) {
    const monitors = await db.monitor.findMany({
      where: { statusHidden: false },
      select: {
        id: true,
        enabled: true,
        lastStatus: true,
        lastResponseMs: true,
        slowThresholdMs: true,
        lastCheckAt: true,
      },
    });
    const ids = monitors.map((m) => m.id);
    const rows = ids.length
      ? await db.check.findMany({
          where: { monitorId: { in: ids }, checkedAt: { gte: new Date(Date.now() - 30 * DAY_MS) } },
          select: { checkedAt: true, status: true },
        })
      : [];

    // Per-day aggregates for the bar strip (UTC days, newest last).
    const byDay = new Map<string, DayBar>();
    for (const r of rows) {
      const key = r.checkedAt.toISOString().slice(0, 10);
      const bar = byDay.get(key) ?? { up: 0, down: 0 };
      if (r.status === "up") bar.up += 1;
      else bar.down += 1;
      byDay.set(key, bar);
    }
    const days: Array<DayBar | undefined> = [];
    for (let i = 29; i >= 0; i--) {
      days.push(byDay.get(new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10)));
    }
    bars = days.map((d) => dayColor(d));

    const total = monitors.length;
    const up = monitors.filter((m) => m.enabled && m.lastStatus === "up").length;
    const down = monitors.filter((m) => m.enabled && m.lastStatus === "down").length;
    const paused = monitors.filter((m) => !m.enabled).length;
    const degraded = monitors.filter((m) => m.enabled && m.lastStatus === "up" && isDegraded(m)).length;
    const lastCheckAt = monitors.reduce<Date | null>(
      (acc, m) => (!m.lastCheckAt ? acc : !acc || m.lastCheckAt > acc ? m.lastCheckAt : acc),
      null,
    );

    // 24h uptime from real checks only.
    const cutoff24 = Date.now() - DAY_MS;
    const in24 = rows.filter((r) => r.checkedAt.getTime() >= cutoff24);
    const up24 = in24.filter((r) => r.status === "up").length;

    kicker = (settings?.statusTitle ?? "Live status").toUpperCase();
    if (total === 0) {
      headline = "No monitors yet";
      headlineColor = COLORS.muted;
    } else if (down > 0) {
      headline = `${down} of ${total} monitors down`;
      headlineColor = COLORS.down;
    } else if (degraded > 0) {
      headline = `${degraded} of ${total} monitors degraded`;
      headlineColor = COLORS.warn;
    } else {
      headline = "All systems operational";
      headlineColor = COLORS.up;
    }

    const parts: string[] = [`${up} up`];
    if (paused > 0) parts.push(`${paused} paused`);
    if (in24.length > 0) parts.push(`${((up24 / in24.length) * 100).toFixed(2)}% uptime · 24h`);
    const ago = agoLabel(lastCheckAt);
    if (ago) parts.push(`checked ${ago}`);
    meta = parts.join("  ·  ");

    barsCaption = "LAST 30 DAYS · REAL CHECKS";
  }

  const card = (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 56,
        backgroundColor: COLORS.bg,
        backgroundImage: `linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(11,12,14,0) 42%)`,
        color: COLORS.fg,
        fontFamily: "sans-serif",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            width: 72,
            height: 72,
            borderRadius: 0,
            backgroundColor: COLORS.violet,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img src={LOGO} width={64} height={64} style={{ width: 64, height: 64, display: "flex" }} alt="" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", fontSize: 44, letterSpacing: 8, color: COLORS.fg }}>PING</div>
          <div style={{ display: "flex", fontSize: 20, color: COLORS.teal, letterSpacing: 3 }}>
            uptime · honestly
          </div>
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            padding: "12px 24px",
            borderRadius: 0,
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.card,
            fontSize: 24,
            color: COLORS.muted,
          }}
        >
          {host || "status page"}
        </div>
      </div>

      {/* headline block */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", fontSize: 24, color: COLORS.dim, letterSpacing: 5 }}>{kicker}</div>
        <div
          style={{
            display: "flex",
            fontSize: 76,
            lineHeight: 1.05,
            color: headlineColor,
            letterSpacing: -1,
            maxWidth: 1060,
          }}
        >
          {headline}
        </div>
        <div style={{ display: "flex", fontSize: 26, color: COLORS.muted }}>{meta}</div>
      </div>

      {/* 30-day bars (status mode) or heartbeat line (generic mode) */}
      {bars ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 6, height: 58 }}>
            {bars.map((color, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flex: 1,
                  height: 58,
                  borderRadius: 0,
                  backgroundColor: color,
                  ...(i === bars.length - 1
                    ? { borderWidth: 1, borderColor: COLORS.teal }
                    : {}),
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: COLORS.muted, letterSpacing: 3 }}>
            {barsCaption}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <img
            src={PULSE}
            width={1088}
            height={90}
            style={{ width: 1088, height: 90, display: "flex" }}
            alt=""
          />
        </div>
      )}
    </div>
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    headers: {
      // fresh enough for unfurls, cached enough to stay cheap
      "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
    },
  });
}
