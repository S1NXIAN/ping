import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";

const schema = z.object({
  name: z.string().trim().min(1, "Folder name is required").max(40),
});

export async function POST(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const existing = await db.folder.findFirst({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json({ error: "A folder with this name already exists" }, { status: 400 });
  }

  const folder = await db.folder.create({ data: { name: parsed.data.name } });
  return NextResponse.json(
    { id: folder.id, name: folder.name, createdAt: folder.createdAt.toISOString() },
    { status: 201 },
  );
}
