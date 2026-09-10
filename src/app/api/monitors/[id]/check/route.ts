import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { runCheck } from "@/lib/checker";
import { toCheckDTO } from "@/lib/ping-stats";

type Params = { params: Promise<{ id: string }> };

/** Runs one real check right now (auth required). */
export async function POST(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const monitor = await db.monitor.findUnique({ where: { id } });
  if (!monitor) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }

  const check = await runCheck(monitor);
  if (!check) {
    // Another trigger (scheduler tick / scheduled ping) is running this
    // monitor's check right now — the in-flight guard refused the duplicate.
    return NextResponse.json(
      { error: "A check for this monitor is already running — try again in a few seconds" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, check: toCheckDTO(check) });
}
