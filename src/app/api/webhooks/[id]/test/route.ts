import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { buildWebhookPayload, deliverWebhook } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

/**
 * Sends one TEST notification to exactly this channel (admin unlock
 * required) — verify a Slack/Discord/generic webhook works before waiting
 * for a real incident. Works on disabled channels too (explicit user
 * intent), and honestly updates the channel's last-attempt stats.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const channel = await db.webhookChannel.findUnique({
    where: { id },
    include: { monitor: { select: { id: true, name: true, url: true, account: true } } },
  });
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Route context: the channel's monitor when routed, else a neutral
  // pseudo-target so the message still reads naturally.
  const m = channel.monitor ?? {
    id: "ping-self-test",
    name: "PING",
    url: "https://ping.invalid/self-test",
    account: null,
  };
  const payload = buildWebhookPayload("test", m, null);
  const result = await deliverWebhook(channel.url, payload);

  // A test IS a delivery attempt — record it honestly.
  await db.webhookChannel
    .update({
      where: { id },
      data: {
        deliveries: { increment: 1 },
        lastDeliveryAt: new Date(),
        lastOk: result.ok,
        lastError: result.error,
      },
    })
    .catch(() => undefined);

  return NextResponse.json(
    {
      ok: result.ok,
      statusCode: result.statusCode,
      error: result.error,
      ms: result.ms,
      event: "test",
      monitorName: channel.monitor?.name ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
