import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { nextMonitorPosition, KEYWORD_MAX_LENGTH, MAX_MONITORS } from "@/lib/checker";
import { monitorUrlSchema, intervalSecSchema, scheduleModeSchema, scheduleTimesSchema, timezoneSchema, scheduleError } from "@/lib/validation";
import type { ImportResult } from "@/lib/ping-types";

const schema = z.object({
  app: z.literal("PING"),
  version: z.literal(1),
  monitors: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        url: monitorUrlSchema,
        method: z.enum(["GET", "HEAD"]).default("GET"),
        intervalSec: intervalSecSchema.default(300),
        enabled: z.boolean().default(true),
        account: z.string().trim().max(60).nullish().transform((v) => (v && v.length > 0 ? v : null)),
        keyword: z
          .string()
          .trim()
          .min(1)
          .max(KEYWORD_MAX_LENGTH)
          .nullish()
          .transform((v) => (v && v.length > 0 ? v : null)),
        keywordMode: z.enum(["contains", "excludes"]).default("contains"),
        slowThresholdMs: z
          .number()
          .int()
          .min(50)
          .max(30000)
          .nullish()
          .transform((v) => (v == null || Number.isNaN(v) ? null : v)),
        folder: z.string().trim().max(40).nullish(),
        // Schedule mode. Absent in exports written before times-of-day existed,
        // so both are optional and default to the interval behaviour.
        scheduleMode: scheduleModeSchema.optional(),
        scheduleTimes: scheduleTimesSchema.nullish(),
        timezone: timezoneSchema.nullish(),
      }),
    )
    .max(200),
  folders: z.array(z.object({ name: z.string().trim().min(1).max(40) })).max(50).optional(),
});

/** Thrown inside the import transaction for a user-facing 400 (rolls back). */
class ImportError extends Error {}

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

  // Validate every monitor's schedule up front (pure) — a bad monitor rejects
  // the whole file before anything is written, the same invariant create and
  // patch enforce.
  for (const m of monitors) {
    const schedErr = scheduleError({
      scheduleMode: m.scheduleMode,
      scheduleTimes: m.scheduleTimes,
      timezone: m.timezone,
    });
    if (schedErr) return NextResponse.json({ error: `${m.name}: ${schedErr}` }, { status: 400 });
  }

  // Everything below is one transaction: the monitor cap is checked inside it
  // against the total the writes themselves see, so two concurrent imports
  // cannot both pass — and any late validation failure rolls the whole import
  // back, leaving the DB untouched rather than half-imported.
  try {
    const result = await db.$transaction(
      async (tx) => {
        // Enforce the create route's monitor cap against the CURRENT total, not
        // just the size of the incoming file: an import must never push the
        // fleet past MAX_MONITORS (the free-tier tick/DB budget). Duplicates are
        // skipped, so only genuinely new URLs count.
        const existingUrls = new Set(
          (await tx.monitor.findMany({ select: { url: true } })).map((m) => m.url),
        );
        const newUrls = new Set<string>();
        for (const m of monitors) if (!existingUrls.has(m.url)) newUrls.add(m.url);
        const existingMonitors = await tx.monitor.count();
        if (existingMonitors + newUrls.size > MAX_MONITORS) {
          throw new ImportError(
            `Monitor limit reached (${MAX_MONITORS}) — ${existingMonitors} exist and this file adds ${newUrls.size}`,
          );
        }

        const existingFolders = await tx.folder.findMany();
        const folderIds = new Map(existingFolders.map((f) => [f.name, f.id]));
        let foldersCreated = 0;

        const wantedFolderNames = new Set(
          monitors.map((m) => m.folder).filter((f): f is string => !!f && f.length > 0),
        );
        for (const name of wantedFolderNames) {
          if (folderIds.has(name)) continue;
          const created = await tx.folder.create({ data: { name } });
          folderIds.set(name, created.id);
          foldersCreated += 1;
        }
        if (folders) {
          for (const f of folders) {
            if (folderIds.has(f.name)) continue;
            const created = await tx.folder.create({ data: { name: f.name } });
            folderIds.set(f.name, created.id);
            foldersCreated += 1;
          }
        }

        let created = 0;
        let skipped = 0;
        let nextPosition = await nextMonitorPosition(tx);
        for (const m of monitors) {
          if (existingUrls.has(m.url)) {
            skipped += 1;
            continue;
          }
          await tx.monitor.create({
            data: {
              name: m.name,
              url: m.url,
              method: m.method,
              intervalSec: m.intervalSec,
              enabled: m.enabled,
              account: m.account ?? null,
              keyword: m.keyword ?? null,
              keywordMode: m.keywordMode,
              slowThresholdMs: m.slowThresholdMs ?? null,
              scheduleMode: m.scheduleMode === "times" ? "times" : "interval",
              scheduleTimes: m.scheduleMode === "times" ? (m.scheduleTimes ?? null) : null,
              timezone: m.scheduleMode === "times" ? (m.timezone ?? null) : null,
              folderId: m.folder ? (folderIds.get(m.folder) ?? null) : null,
              position: nextPosition,
            },
          });
          nextPosition += 1;
          existingUrls.add(m.url);
          created += 1;
        }

        return { created, skipped, foldersCreated };
      },
      // A max-size import writes hundreds of rows; Prisma's 5s default could
      // abort a valid import with P2028 on a slow SQLite instance.
      { timeout: 30_000 },
    );

    const body: ImportResult = result;
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
