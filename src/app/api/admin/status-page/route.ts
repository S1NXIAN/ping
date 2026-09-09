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
    title: settings?.statusTitle ?? null,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

const actionSchema = z.union([
  z.object({
    action: z.literal("enable"),
  }),
  z.object({
    action: z.literal("disable"),
  }),
  z.object({
    action: z.literal("regenerate"),
  }),
  z.object({
    action: z.literal("title"),
    // null or "" clears the custom title; otherwise 1–60 chars
    title: z
      .string()
      .trim()
      .max(60, "Title is too long (60 chars max)")
      .nullish()
      .transform((v) => (v === "" ? null : v)),
  }),
]);

/**
 * enable  → generates a fresh token (or keeps the existing one)
 * regenerate → always creates a new token; old links stop working
 * disable → clears the token; the public endpoint 404s
 * title   → sets / clears the custom page title (token untouched)
 */
export async function POST(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid action" },
      { status: 400 },
    );
  }

  const settings = await db.settings.findUnique({ where: { id: "main" } });
  if (!settings) {
    return NextResponse.json({ error: "Settings not initialized" }, { status: 500 });
  }

  if (parsed.data.action === "title") {
    await db.settings.update({
      where: { id: "main" },
      data: { statusTitle: parsed.data.title ?? null },
    });
    const res: StatusPageInfoResponse = {
      enabled: !!settings.statusToken,
      token: settings.statusToken,
      title: parsed.data.title ?? null,
    };
    return NextResponse.json(res);
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

  const res: StatusPageInfoResponse = {
    enabled: !!token,
    token,
    title: settings.statusTitle ?? null,
  };
  return NextResponse.json(res);
}
