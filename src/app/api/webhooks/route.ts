import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { MAX_WEBHOOK_CHANNELS, isPrivateWebhookUrl } from "@/lib/webhooks";
import type { WebhookChannelDTO } from "@/lib/ping-types";

function toDTO(
  ch: {
    id: string;
    name: string;
    url: string;
    monitorId: string | null;
    notifyDown: boolean;
    notifyUp: boolean;
    notifySlow: boolean;
    enabled: boolean;
    createdAt: Date;
    deliveries: number;
    lastDeliveryAt: Date | null;
    lastOk: boolean | null;
    lastError: string | null;
  },
  monitorName: string | null,
): WebhookChannelDTO {
  return {
    ...ch,
    monitorName,
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
  }, "Enter a valid http(s) webhook URL")
  // SSRF: the URL must not point at loopback/private/link-local space —
  // PING must never be usable to probe internal infrastructure.
  .refine((v) => !isPrivateWebhookUrl(v), "Webhook URL must be a public http(s) endpoint — private/internal addresses are blocked");

/** Lists all notification channels (admin unlock required). */
export async function GET(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const channels = await db.webhookChannel.findMany({
    orderBy: { createdAt: "asc" },
    include: { monitor: { select: { name: true } } },
  });
  return NextResponse.json(
    channels.map((ch) => toDTO(ch, ch.monitor?.name ?? null)),
    { headers: { "Cache-Control": "no-store" } },
  );
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(60, "Name is too long (60 chars max)"),
  url: urlSchema,
  notifyDown: z.boolean().optional().default(true),
  notifyUp: z.boolean().optional().default(true),
  notifySlow: z.boolean().optional().default(true),
  /** Route events for this monitor only; omit/null = every monitor. */
  monitorId: z.string().trim().min(1).nullish(),
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

  const { name, url, notifyDown, notifyUp, notifySlow, monitorId } = parsed.data;
  if (!notifyDown && !notifyUp && !notifySlow) {
    return NextResponse.json(
      { error: "Enable at least one event (down, up, or slow)" },
      { status: 400 },
    );
  }

  if (monitorId) {
    const monitor = await db.monitor.findUnique({ where: { id: monitorId }, select: { id: true, name: true } });
    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }
    const channel = await db.webhookChannel.create({
      data: { name, url, notifyDown, notifyUp, notifySlow, monitorId },
    });
    return NextResponse.json(toDTO(channel, monitor.name), { status: 201 });
  }

  const channel = await db.webhookChannel.create({
    data: { name, url, notifyDown, notifyUp, notifySlow, monitorId: null },
  });
  return NextResponse.json(toDTO(channel, null), { status: 201 });
}
