import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { deriveIncidents } from "@/lib/incidents";

/**
 * Public RSS 2.0 feed for the status page — NO session required, gated by
 * the unguessable status-page token, same as the badge:
 *
 *   https://host/api/public/feed?token=…
 *
 * Items: recent incidents (down periods with optional postmortem notes) and
 * upcoming/active maintenance windows. Feed data is a subset of what the
 * status page already shows publicly — names, timestamps and notes only,
 * never URLs, accounts or raw history. A wrong or missing token gets the
 * same 404 as a disabled page (reveals nothing).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const settings = await db.settings.findUnique({ where: { id: "main" } });

  const valid =
    !!settings?.statusToken &&
    token.length === settings.statusToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(settings.statusToken));

  if (!valid) {
    return NextResponse.json({ error: "Status page not found" }, { status: 404 });
  }

  const monitors = await db.monitor.findMany({
    where: { statusHidden: false },
    select: { id: true, name: true, intervalSec: true },
  });

  const incidents = await deriveIncidents(monitors);
  const noteRows = await db.incidentNote.findMany({
    where: { monitorId: { in: monitors.map((m) => m.id) } },
    select: { monitorId: true, startedAt: true, note: true },
  });
  const noteByKey = new Map(
    noteRows.map((n) => [`${n.monitorId}:${n.startedAt.getTime()}`, n.note] as const),
  );

  const now = new Date();
  const windows = await db.maintenanceWindow.findMany({
    where: { monitorId: { in: monitors.map((m) => m.id) }, endsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    take: 20,
  });

  interface Item {
    title: string;
    description: string;
    date: Date;
    guid: string;
  }

  const nameById = new Map(monitors.map((m) => [m.id, m.name] as const));

  const items: Item[] = [];

  // Incidents, newest first (deriveIncidents already returns them that way).
  for (const inc of incidents) {
    const start = new Date(inc.startedAt);
    const end = inc.endedAt ? new Date(inc.endedAt) : null;
    const during = inc.duringMaintenance;
    const note = noteByKey.get(`${inc.monitorId}:${start.getTime()}`);
    items.push({
      title: `${inc.monitorName} — ${end ? "resolved incident" : "ongoing incident"}${during ? " (during maintenance)" : ""}`,
      description:
        `Down from ${start.toUTCString()}${end ? ` to ${end.toUTCString()}` : " — still down"}` +
        ` · ${inc.downChecks} failed check${inc.downChecks === 1 ? "" : "s"}` +
        (inc.lastStatusCode != null ? ` · last HTTP ${inc.lastStatusCode}` : "") +
        (note ? `\nNote: ${note}` : ""),
      date: end ?? start,
      guid: `incident-${inc.monitorId}-${start.getTime()}`,
    });
  }

  // Active + upcoming maintenance windows.
  for (const w of windows) {
    const name = nameById.get(w.monitorId) ?? "?";
    const active = w.startsAt.getTime() <= now.getTime();
    items.push({
      title: `${name} — ${active ? "maintenance in progress" : "scheduled maintenance"}`,
      description:
        `${w.startsAt.toUTCString()} → ${w.endsAt.toUTCString()}` +
        (w.note ? `\nNote: ${w.note}` : ""),
      date: w.startsAt,
      guid: `maintenance-${w.id}`,
    });
  }

  items.sort((a, b) => b.date.getTime() - a.date.getTime());

  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const title = settings?.statusTitle || "PING status";
  const selfUrl = `${req.nextUrl.origin}/api/public/feed?token=${token}`;
  const siteUrl = `${req.nextUrl.origin}/?status=${token}`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `<channel>\n` +
    `  <title>${esc(title)}</title>\n` +
    `  <link>${esc(siteUrl)}</link>\n` +
    `  <description>Incidents and maintenance from ${esc(title)} — real recorded checks only.</description>\n` +
    `  <language>en</language>\n` +
    `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n` +
    `  <ttl>15</ttl>\n` +
    `  <atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml"/>\n` +
    (items.length === 0
      ? `  <item>\n    <title>No incidents in the last 30 days</title>\n    <description>Nothing to report — all quiet.</description>\n    <pubDate>${new Date().toUTCString()}</pubDate>\n    <guid>quiet-${new Date().toISOString().slice(0, 10)}</guid>\n    <link>${esc(siteUrl)}</link>\n  </item>\n`
      : items
          .map(
            (it) =>
              `  <item>\n` +
              `    <title>${esc(it.title)}</title>\n` +
              `    <description>${esc(it.description).replaceAll("\n", "&lt;br&gt;")}</description>\n` +
              `    <pubDate>${it.date.toUTCString()}</pubDate>\n` +
              `    <guid>${esc(it.guid)}</guid>\n` +
              `    <link>${esc(siteUrl)}</link>\n` +
              `  </item>\n`,
          )
          .join("")) +
    `</channel>\n` +
    `</rss>\n`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
