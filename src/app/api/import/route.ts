import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { nextMonitorPosition } from "@/lib/checker";
import type { ImportResult } from "@/lib/ping-types";

const schema = z.object({
  app: z.literal("PING"),
  version: z.literal(1),
  monitors: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        url: z.string().trim().min(4).max(500),
        method: z.enum(["GET", "HEAD"]).default("GET"),
        intervalSec: z.number().int().min(60).max(86400).default(300),
        enabled: z.boolean().default(true),
        account: z.string().trim().max(60).nullish().transform((v) => (v && v.length > 0 ? v : null)),
        folder: z.string().trim().max(40).nullish(),
      }),
    )
    .max(200),
  folders: z.array(z.object({ name: z.string().trim().min(1).max(40) })).max(50).optional(),
});

/** Restores monitors/folders from a PING export. Duplicated URLs are skipped. */
export async function POST(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Not a valid PING export" },
      { status: 400 },
    );
  }

  const { folders, monitors } = parsed.data;
  const existingFolders = await db.folder.findMany();
  const folderIds = new Map(existingFolders.map((f) => [f.name, f.id]));
  let foldersCreated = 0;

  const wantedFolderNames = new Set(
    monitors.map((m) => m.folder).filter((f): f is string => !!f && f.length > 0),
  );
  for (const name of wantedFolderNames) {
    if (folderIds.has(name)) continue;
    const created = await db.folder.create({ data: { name } });
    folderIds.set(name, created.id);
    foldersCreated += 1;
  }
  if (folders) {
    for (const f of folders) {
      if (folderIds.has(f.name)) continue;
      const created = await db.folder.create({ data: { name: f.name } });
      folderIds.set(f.name, created.id);
      foldersCreated += 1;
    }
  }

  const existingUrls = new Set(
    (await db.monitor.findMany({ select: { url: true } })).map((m) => m.url),
  );

  let created = 0;
  let skipped = 0;
  let nextPosition = await nextMonitorPosition();
  for (const m of monitors) {
    if (existingUrls.has(m.url)) {
      skipped += 1;
      continue;
    }
    await db.monitor.create({
      data: {
        name: m.name,
        url: m.url,
        method: m.method,
        intervalSec: m.intervalSec,
        enabled: m.enabled,
        account: m.account ?? null,
        folderId: m.folder ? (folderIds.get(m.folder) ?? null) : null,
        position: nextPosition,
      },
    });
    nextPosition += 1;
    existingUrls.add(m.url);
    created += 1;
  }

  const result: ImportResult = { created, skipped, foldersCreated };
  return NextResponse.json(result);
}
