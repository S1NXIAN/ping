import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1, "Folder name is required").max(40),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id } });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const clash = await db.folder.findFirst({ where: { name: parsed.data.name, id: { not: id } } });
  if (clash) {
    return NextResponse.json({ error: "A folder with this name already exists" }, { status: 400 });
  }

  const updated = await db.folder.update({ where: { id }, data: { name: parsed.data.name } });
  return NextResponse.json({ ok: true, id: updated.id });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id } });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  // Monitors keep existing, they just move back to the root level.
  await db.folder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
