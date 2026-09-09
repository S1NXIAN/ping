import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { buildWebhookPayload, deliverWebhook } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

/**
 * Sends a synthetic "test" event to one channel right now (admin unlock
 * required). Records the honest outcome on the channel row and returns it
 * to the caller — no faking success.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const channel = await db.webhookChannel.findUnique({ where: { id } });
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const payload = buildWebhookPayload("test", {
    id: "test",
    name: channel.name,
    url: req.nextUrl.origin,
    account: null,
  }, null);
  const result = await deliverWebhook(channel.url, payload);

  await db.webhookChannel.update({
    where: { id },
    data: {
      deliveries: { increment: 1 },
      lastDeliveryAt: new Date(),
      lastOk: result.ok,
      lastError: result.error,
    },
  });

  return NextResponse.json({
    ok: result.ok,
    statusCode: result.statusCode,
    error: result.error,
    ms: result.ms,
  });
}
