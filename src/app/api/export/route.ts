import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";

/** Exports folders + monitor configuration, webhook channels and upcoming
 *  maintenance windows (no check history) as JSON. */
export async function GET(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const [folders, monitors, channels, windows] = await Promise.all([
    db.folder.findMany({ orderBy: { createdAt: "asc" } }),
    db.monitor.findMany({ orderBy: { createdAt: "asc" } }),
    db.webhookChannel.findMany({ orderBy: { createdAt: "asc" } }),
    db.maintenanceWindow.findMany({
      where: { endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const monitorById = new Map(monitors.map((m) => [m.id, m]));

  const payload = {
    app: "PING",
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: folders.map((f) => ({ name: f.name })),
    monitors: monitors.map((m) => ({
      name: m.name,
      url: m.url,
      method: m.method,
      intervalSec: m.intervalSec,
      enabled: m.enabled,
      account: m.account,
      folder: folders.find((f) => f.id === m.folderId)?.name ?? null,
    })),
    webhookChannels: channels.map((ch) => ({
      name: ch.name,
      url: ch.url,
      notifyDown: ch.notifyDown,
      notifyUp: ch.notifyUp,
      enabled: ch.enabled,
      monitor: ch.monitorId ? (monitorById.get(ch.monitorId)?.name ?? null) : null,
    })),
    maintenanceWindows: windows.map((w) => ({
      monitor: monitorById.get(w.monitorId)?.name ?? null,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      note: w.note,
    })),
  };

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="ping-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
