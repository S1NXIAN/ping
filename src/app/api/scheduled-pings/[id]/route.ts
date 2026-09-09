import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";

type Params = { params: Promise<{ id: string }> };

/** Cancels a pending scheduled ping (it is removed — it never ran). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const ping = await db.scheduledPing.findUnique({ where: { id }, select: { status: true } });
  if (!ping) {
    return NextResponse.json({ error: "Scheduled ping not found" }, { status: 404 });
  }
  if (ping.status !== "pending") {
    return NextResponse.json(
      { error: "This ping already ran — it cannot be cancelled" },
      { status: 409 },
    );
  }

  await db.scheduledPing.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
