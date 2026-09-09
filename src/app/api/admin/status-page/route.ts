import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import type { StatusPageInfoResponse } from "@/lib/ping-types";

function newToken(): string {
  return randomBytes(24).toString("hex"); // 48 hex chars, 192 bits
}

/** Current status-page state (requires an unlocked admin). */
export async function GET(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const settings = await db.settings.findUnique({ where: { id: "main" } });
  const body: StatusPageInfoResponse = {
    enabled: !!settings?.statusToken,
    token: settings?.statusToken ?? null,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

const actionSchema = z.object({
  action: z.enum(["enable", "disable", "regenerate"]),
});

/**
 * enable  → generates a fresh token (or keeps the existing one)
 * regenerate → always creates a new token; old links stop working
 * disable → clears the token; the public endpoint 404s
 */
export async function POST(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const settings = await db.settings.findUnique({ where: { id: "main" } });
  if (!settings) {
    return NextResponse.json({ error: "Settings not initialized" }, { status: 500 });
  }

  let token: string | null;
  if (parsed.data.action === "disable") {
    token = null;
  } else if (parsed.data.action === "regenerate" || !settings.statusToken) {
    token = newToken();
  } else {
    token = settings.statusToken;
  }

  await db.settings.update({ where: { id: "main" }, data: { statusToken: token } });

  const res: StatusPageInfoResponse = { enabled: !!token, token };
  return NextResponse.json(res);
}
