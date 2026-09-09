import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { deriveIncidents, incidentsWithNotes } from "@/lib/incidents";

const NOTE_MAX = 500;

/** Lists the last 30 days of derived incidents (all monitors, incl. hidden)
 *  with their admin postmortem notes. Session required. */
export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const monitors = await db.monitor.findMany({
    select: { id: true, name: true, intervalSec: true },
    orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  const derived = await deriveIncidents(monitors);
  const incidents = await incidentsWithNotes(derived);
  return NextResponse.json(
    { incidents },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const noteSchema = z.object({
  monitorId: z.string().trim().min(1),
  /** Exact ISO start of the derived incident (first failed check). */
  startedAt: z.string().datetime(),
  note: z.string().trim().min(1, "Note cannot be empty").max(NOTE_MAX, `Note is too long (${NOTE_MAX} chars max)`),
});

/** Creates or updates the postmortem note attached to one incident. */
export async function POST(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { monitorId, startedAt, note } = parsed.data;
  const monitor = await db.monitor.findUnique({ where: { id: monitorId }, select: { id: true } });
  if (!monitor) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid startedAt" }, { status: 400 });
  }

  const row = await db.incidentNote.upsert({
    where: { monitorId_startedAt: { monitorId, startedAt: start } },
    create: { monitorId, startedAt: start, note },
    update: { note },
  });
  return NextResponse.json({ ok: true, noteId: row.id });
}

/** Removes the note for one incident (by monitor + exact start). */
export async function DELETE(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const monitorId = req.nextUrl.searchParams.get("monitorId") ?? "";
  const startedAt = req.nextUrl.searchParams.get("startedAt") ?? "";
  if (!monitorId || !startedAt) {
    return NextResponse.json({ error: "monitorId and startedAt are required" }, { status: 400 });
  }
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid startedAt" }, { status: 400 });
  }

  await db.incidentNote.deleteMany({ where: { monitorId, startedAt: start } });
  return NextResponse.json({ ok: true });
}
