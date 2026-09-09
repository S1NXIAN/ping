import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { toScheduledPingDTO } from "@/lib/ping-stats";

const MAX_PER_MONITOR = 20;
const MAX_TOTAL_PENDING = 200;
const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const createSchema = z.object({
  monitorId: z.string().trim().min(1),
  /** Epoch milliseconds (client converts its local datetime to this). */
  runAt: z.number().int().finite(),
  note: z.string().trim().max(120).nullish().transform((v) => (v && v.length > 0 ? v : null)),
});

/** Schedules a one-off real check at a specific moment. */
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
  const { monitorId, runAt, note } = parsed.data;

  const monitor = await db.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }

  const now = Date.now();
  if (runAt < now - 30_000) {
    return NextResponse.json({ error: "Pick a time in the future" }, { status: 400 });
  }
  if (runAt > now + MAX_AHEAD_MS) {
    return NextResponse.json({ error: "Pick a time within the next 90 days" }, { status: 400 });
  }

  const [perMonitor, totalPending] = await Promise.all([
    db.scheduledPing.count({ where: { monitorId, status: "pending" } }),
    db.scheduledPing.count({ where: { status: "pending" } }),
  ]);
  if (perMonitor >= MAX_PER_MONITOR) {
    return NextResponse.json(
      { error: `This monitor already has ${MAX_PER_MONITOR} scheduled pings` },
      { status: 400 },
    );
  }
  if (totalPending >= MAX_TOTAL_PENDING) {
    return NextResponse.json({ error: "Too many scheduled pings — cancel some first" }, { status: 400 });
  }

  const ping = await db.scheduledPing.create({
    data: { monitorId, runAt: new Date(runAt), note },
  });

  return NextResponse.json(toScheduledPingDTO(ping, monitor.name), { status: 201 });
}
