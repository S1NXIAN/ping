import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { nextMonitorPosition } from "@/lib/checker";
import { MAX_WEBHOOK_CHANNELS } from "@/lib/webhooks";
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
  webhookChannels: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        url: z.string().trim().min(8).max(500),
        notifyDown: z.boolean().default(true),
        notifyUp: z.boolean().default(true),
        enabled: z.boolean().default(true),
        monitor: z.string().trim().max(80).nullish(),
      }),
    )
    .max(5)
    .optional(),
  maintenanceWindows: z
    .array(
      z.object({
        monitor: z.string().trim().min(1).max(80),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        note: z.string().trim().max(120).nullish(),
      }),
    )
    .max(50)
    .optional(),
});

/** Restores monitors/folders, webhook channels and future maintenance windows
 *  from a PING export. Duplicated URLs and channel names are skipped. */
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

  const { folders, monitors, webhookChannels, maintenanceWindows } = parsed.data;
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
  let channelsCreated = 0;
  let windowsCreated = 0;
  let nextPosition = await nextMonitorPosition();
  const monitorIdByUrl = new Map<string, string>();
  const monitorIdByName = new Map<string, string>();
  for (const m of monitors) {
    if (existingUrls.has(m.url)) {
      skipped += 1;
      continue;
    }
    const row = await db.monitor.create({
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
    monitorIdByUrl.set(m.url, row.id);
    monitorIdByName.set(m.name, row.id);
    nextPosition += 1;
    existingUrls.add(m.url);
    created += 1;
  }

  // Existing monitors (not just imported ones) can be routing targets too.
  for (const m of await db.monitor.findMany({ select: { id: true, name: true, url: true } })) {
    if (!monitorIdByUrl.has(m.url)) monitorIdByUrl.set(m.url, m.id);
    if (!monitorIdByName.has(m.name)) monitorIdByName.set(m.name, m.id);
  }

  // Webhook channels — skip ones whose URL already exists.
  if (webhookChannels) {
    const existingChannelUrls = new Set(
      (await db.webhookChannel.findMany({ select: { url: true } })).map((c) => c.url),
    );
    let channelCount = await db.webhookChannel.count();
    for (const ch of webhookChannels) {
      if (channelCount >= MAX_WEBHOOK_CHANNELS) break;
      if (existingChannelUrls.has(ch.url)) continue;
      await db.webhookChannel.create({
        data: {
          name: ch.name,
          url: ch.url,
          notifyDown: ch.notifyDown,
          notifyUp: ch.notifyUp,
          enabled: ch.enabled,
          monitorId: ch.monitor ? (monitorIdByName.get(ch.monitor) ?? null) : null,
        },
      });
      existingChannelUrls.add(ch.url);
      channelCount += 1;
      channelsCreated += 1;
    }
  }

  // Maintenance windows — only future ones, attached to monitors that exist
  // by name (imported or pre-existing). Re-importing the same file skips
  // windows that already exist (same monitor + start time).
  if (maintenanceWindows) {
    const now = Date.now();
    const existingWindows = new Set(
      (
        await db.maintenanceWindow.findMany({
          where: { endsAt: { gte: new Date(now) } },
          select: { monitorId: true, startsAt: true },
        })
      ).map((w) => `${w.monitorId}:${w.startsAt.getTime()}`),
    );
    for (const w of maintenanceWindows) {
      const startsAt = new Date(w.startsAt);
      const endsAt = new Date(w.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;
      if (endsAt.getTime() <= now || endsAt.getTime() <= startsAt.getTime()) continue;
      const monitorId = monitorIdByName.get(w.monitor);
      if (!monitorId) continue;
      if (existingWindows.has(`${monitorId}:${startsAt.getTime()}`)) continue;
      await db.maintenanceWindow.create({
        data: { monitorId, startsAt, endsAt, note: w.note ?? null },
      });
      existingWindows.add(`${monitorId}:${startsAt.getTime()}`);
      windowsCreated += 1;
    }
  }

  const result: ImportResult & { channelsCreated: number; windowsCreated: number } = {
    created,
    skipped,
    foldersCreated,
    channelsCreated,
    windowsCreated,
  };
  return NextResponse.json(result);
}
