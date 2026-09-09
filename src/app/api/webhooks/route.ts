import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { MAX_WEBHOOK_CHANNELS } from "@/lib/webhooks";
import type { WebhookChannelDTO } from "@/lib/ping-types";

function toDTO(ch: {
  id: string;
  name: string;
  url: string;
  notifyDown: boolean;
  notifyUp: boolean;
  enabled: boolean;
  createdAt: Date;
  deliveries: number;
  lastDeliveryAt: Date | null;
  lastOk: boolean | null;
  lastError: string | null;
}): WebhookChannelDTO {
  return {
    ...ch,
    createdAt: ch.createdAt.toISOString(),
    lastDeliveryAt: ch.lastDeliveryAt?.toISOString() ?? null,
  };
}

export const urlSchema = z
  .string()
  .trim()
  .min(8)
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a valid http(s) webhook URL");

/** Lists all notification channels (admin unlock required). */
export async function GET(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const channels = await db.webhookChannel.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(channels.map(toDTO), { headers: { "Cache-Control": "no-store" } });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(60, "Name is too long (60 chars max)"),
  url: urlSchema,
  notifyDown: z.boolean().optional().default(true),
  notifyUp: z.boolean().optional().default(true),
});

/** Creates a notification channel (admin unlock required). */
export async function POST(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const count = await db.webhookChannel.count();
  if (count >= MAX_WEBHOOK_CHANNELS) {
    return NextResponse.json(
      { error: `Channel limit reached (${MAX_WEBHOOK_CHANNELS}). Delete one first.` },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, url, notifyDown, notifyUp } = parsed.data;
  if (!notifyDown && !notifyUp) {
    return NextResponse.json(
      { error: "Enable at least one event (down, up or both)" },
      { status: 400 },
    );
  }

  const channel = await db.webhookChannel.create({
    data: { name, url, notifyDown, notifyUp },
  });
  return NextResponse.json(toDTO(channel), { status: 201 });
}
