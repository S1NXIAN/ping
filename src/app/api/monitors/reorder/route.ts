import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";

const schema = z
  .object({
    /** Full desired order of monitor ids (manual sort). */
    ids: z.array(z.string().trim().min(1)).min(1).max(200),
    /** Which of those ids should be pinned (they float to the top). */
    pinnedIds: z.array(z.string().trim().min(1)).max(200).optional(),
  })
  .refine((v) => new Set(v.ids).size === v.ids.length, { message: "ids contains duplicates" })
  .refine((v) => (v.pinnedIds ?? []).every((p) => v.ids.includes(p)), {
    message: "pinnedIds must be a subset of ids",
  });

/**
 * Persists the manual monitor order: position = index in `ids`, and pinned
 * flags are set exactly from `pinnedIds`. Monitors not present in the list
 * keep their current position and pinned state.
 */
export async function PATCH(req: NextRequest) {
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

  const { ids, pinnedIds = [] } = parsed.data;
  const pinnedSet = new Set(pinnedIds);

  const existing = await db.monitor.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((m) => m.id));
  if (!ids.every((id) => existingIds.has(id))) {
    return NextResponse.json({ error: "Unknown monitor in order" }, { status: 400 });
  }

  await db.$transaction(
    ids.map((id, i) =>
      db.monitor.update({
        where: { id },
        data: { position: i, pinned: pinnedSet.has(id) },
      }),
    ),
  );

  return NextResponse.json({ ok: true, ordered: ids.length });
}
