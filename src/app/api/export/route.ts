import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";

/** Exports folders + monitor configuration (no check history) as JSON. */
export async function GET(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const [folders, monitors] = await Promise.all([
    db.folder.findMany({ orderBy: { createdAt: "asc" } }),
    db.monitor.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

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
