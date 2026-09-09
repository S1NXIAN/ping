import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";

type Params = { params: Promise<{ id: string }> };

/** Cancels a maintenance window (any state — active, upcoming or past). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const exists = await db.maintenanceWindow.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "Maintenance window not found" }, { status: 404 });
  }
  await db.maintenanceWindow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
