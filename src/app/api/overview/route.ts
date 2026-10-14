import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { collectMonitorStats, toMonitorDTO } from "@/lib/ping-stats";
import type { OverviewResponse } from "@/lib/ping-types";

export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const [monitors, folders, bundle] = await Promise.all([
    // Pinned first, then the user's manual order, then oldest-created as a tiebreak.
    db.monitor.findMany({ orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }] }),
    db.folder.findMany({ orderBy: { createdAt: "asc" } }),
    // includeAllTime: false — the overview polls every 15s and never shows
    // totalChecks/firstCheckAt (only the detail sheet does), so it skips the
    // unbounded all-time scan. Those fields come back null.
    collectMonitorStats(undefined, { includeAllTime: false }),
  ]);

  const folderById = new Map(folders.map((f) => [f.id, f]));
  const dtos = monitors.map((m) =>
    toMonitorDTO(
      m,
      m.folderId ? (folderById.get(m.folderId) ?? null) : null,
      bundle.statsByMonitor.get(m.id),
      bundle.recentByMonitor.get(m.id),
    ),
  );

  // No server-side summary: the client derives the stat strip and header pills
  // from these monitors, scoped to the active Folder (see lib/summary.ts).
  const body: OverviewResponse = {
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.createdAt.toISOString(),
    })),
    monitors: dtos,
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
