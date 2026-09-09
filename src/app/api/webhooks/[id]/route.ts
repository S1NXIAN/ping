import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminGuard } from "@/lib/ping-auth";
import { urlSchema } from "../route";
import type { WebhookChannelDTO } from "@/lib/ping-types";

type Params = { params: Promise<{ id: string }> };

function toDTO(
  ch: {
    id: string;
    name: string;
    url: string;
    monitorId: string | null;
    notifyDown: boolean;
    notifyUp: boolean;
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

const patchSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(60, "Name is too long (60 chars max)").optional(),
  url: urlSchema.optional(),
  notifyDown: z.boolean().optional(),
  notifyUp: z.boolean().optional(),
  enabled: z.boolean().optional(),
  /** null clears routing (all monitors); a string routes to one monitor. */
  monitorId: z.string().trim().min(1).nullish(),
});

/** Updates a notification channel (admin unlock required). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const channel = await db.webhookChannel.findUnique({ where: { id } });
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  const { name, url, notifyDown, notifyUp, enabled, monitorId } = parsed.data;
  if (name !== undefined) data.name = name;
  if (url !== undefined) data.url = url;
  if (notifyDown !== undefined) data.notifyDown = notifyDown;
  if (notifyUp !== undefined) data.notifyUp = notifyUp;
  if (enabled !== undefined) data.enabled = enabled;
  if (monitorId !== undefined) {
    if (monitorId) {
      const monitor = await db.monitor.findUnique({ where: { id: monitorId }, select: { id: true } });
      if (!monitor) {
        return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
      }
    }
    data.monitorId = monitorId ?? null;
  }

  const merged = {
    notifyDown: (data.notifyDown as boolean | undefined) ?? channel.notifyDown,
    notifyUp: (data.notifyUp as boolean | undefined) ?? channel.notifyUp,
  };
  if (!merged.notifyDown && !merged.notifyUp) {
    return NextResponse.json(
      { error: "Enable at least one event (down, up or both)" },
      { status: 400 },
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db.webhookChannel.update({
    where: { id },
    data,
    include: { monitor: { select: { name: true } } },
  });
  return NextResponse.json(toDTO(updated, updated.monitor?.name ?? null));
}

/** Deletes a notification channel (admin unlock required). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const exists = await db.webhookChannel.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
  await db.webhookChannel.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
