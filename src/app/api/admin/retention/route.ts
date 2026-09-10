import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { pruneChecks, runtimeState } from "@/lib/checker";
import type { RetentionResponse } from "@/lib/ping-types";

async function responseBody(): Promise<RetentionResponse> {
  const settings = await db.settings.findUnique({
    where: { id: "main" },
    select: { retentionDays: true },
  });
  return {
    retentionDays: settings?.retentionDays ?? null,
    lastPrunedAt: runtimeState.lastPrunedAt,
    lastPrunedCount: runtimeState.lastPrunedCount,
  };
}

/** Current retention configuration (requires an unlocked admin). */
export async function GET(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await responseBody(), {
    headers: { "Cache-Control": "no-store" },
  });
}

const actionSchema = z.union([
  z.object({
    action: z.literal("set"),
    // null = default policy (30 days + 1,000/monitor cap)
    // 0    = keep forever
    // N    = keep N days (1–3650, no cap)
    days: z
      .number()
      .int("Days must be a whole number")
      .min(0, "Days must be 0 or more")
      .max(3650, "3650 days (10 years) is the maximum")
      .nullable(),
  }),
  z.object({ action: z.literal("prune") }),
]);

/**
 * set   → store the retention policy (null/0/N, see schema comment)
 * prune → run the pruner right now and report how many checks it deleted
 */
export async function POST(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const settings = await db.settings.findUnique({ where: { id: "main" } });
  if (!settings) {
    return NextResponse.json({ error: "Settings not initialized" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid action" },
      { status: 400 },
    );
  }

  if (parsed.data.action === "set") {
    await db.settings.update({
      where: { id: "main" },
      data: { retentionDays: parsed.data.days },
    });
    const r = await responseBody();
    return NextResponse.json({
      ...r,
      applied:
        parsed.data.days == null
          ? "default policy (30 days + per-monitor cap)"
          : parsed.data.days === 0
            ? "keep forever"
            : `${parsed.data.days} days`,
    });
  }

  // action === "prune": applies the CURRENT policy immediately.
  const result = await pruneChecks();
  const r = await responseBody();
  return NextResponse.json({ ...r, deleted: result.deleted });
}
