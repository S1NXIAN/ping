import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { MAX_WINDOWS_PER_MONITOR, MAX_WINDOWS_TOTAL } from "@/lib/checker";
import { toMaintenanceDTO } from "@/lib/ping-stats";

const MAINTENANCE_HORIZON_DAYS = 90;
/** How far in the past a window may start (active windows started earlier). */
const MAX_PAST_START_MS = 60 * 60 * 1000;

/** Lists maintenance windows: active + upcoming, then recently ended. */
export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const rows = await db.maintenanceWindow.findMany({
    where: { endsAt: { gte: new Date(Date.now() - 2 * 86400_000) } },
    orderBy: { startsAt: "asc" },
    take: 100,
  });
  const monitors = await db.monitor.findMany({ select: { id: true, name: true } });
  const nameById = new Map(monitors.map((m) => [m.id, m.name]));

  return NextResponse.json(
    rows.filter((w) => nameById.has(w.monitorId)).map((w) => toMaintenanceDTO(w, nameById.get(w.monitorId) ?? "?")),
    { headers: { "Cache-Control": "no-store" } },
  );
}

const createSchema = z.object({
  monitorId: z.string().trim().min(1),
  startsAt: z.number().int().finite(), // epoch ms
  endsAt: z.number().int().finite(), // epoch ms
  note: z.string().trim().max(120).nullish().transform((v) => (v && v.length > 0 ? v : null)),
});

/** Schedules a maintenance window for one monitor. */
export async function POST(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { monitorId, startsAt, endsAt, note } = parsed.data;

  const monitor = await db.monitor.findUnique({ where: { id: monitorId }, select: { id: true, name: true } });
  if (!monitor) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }

  const now = Date.now();
  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "The window must end after it starts" }, { status: 400 });
  }
  if (startsAt < now - MAX_PAST_START_MS) {
    return NextResponse.json({ error: "Start time is too far in the past" }, { status: 400 });
  }
  if (endsAt > now + MAINTENANCE_HORIZON_DAYS * 86400_000) {
    return NextResponse.json(
      { error: `Windows can be at most ${MAINTENANCE_HORIZON_DAYS} days ahead` },
      { status: 400 },
    );
  }
  if (endsAt - startsAt > 7 * 86400_000) {
    return NextResponse.json({ error: "A window can last at most 7 days" }, { status: 400 });
  }

  const [perMonitor, total] = await Promise.all([
    db.maintenanceWindow.count({ where: { monitorId } }),
    db.maintenanceWindow.count(),
  ]);
  if (perMonitor >= MAX_WINDOWS_PER_MONITOR) {
    return NextResponse.json(
      { error: `This monitor already has ${MAX_WINDOWS_PER_MONITOR} windows — cancel one first.` },
      { status: 400 },
    );
  }
  if (total >= MAX_WINDOWS_TOTAL) {
    return NextResponse.json(
      { error: `Total window limit reached (${MAX_WINDOWS_TOTAL}) — cancel one first.` },
      { status: 400 },
    );
  }

  const window = await db.maintenanceWindow.create({
    data: { monitorId, startsAt: new Date(startsAt), endsAt: new Date(endsAt), note },
  });
  return NextResponse.json(toMaintenanceDTO(window, monitor.name), { status: 201 });
}
