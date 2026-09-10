// PING webhook notifications — one fire-and-forget POST per up/down event.
// Payload includes Slack's `text`, Discord's `content` and a structured
// `event` object, so generic receivers can pick whichever they understand.
// Delivery is best-effort: 10s timeout, no retries, honest last-attempt
// stats stored on each channel row. Nothing here ever throws.
import type { Monitor } from "@prisma/client";
import { db } from "./db";

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const MAX_WEBHOOK_CHANNELS = 5;

export type WebhookEvent = "down" | "up" | "slow" | "test";
export interface WebhookPayload {
  /** Human-readable one-liner (also used by Slack). */
  text: string;
  /** Same message under Discord's field name. */
  content: string;
  event: WebhookEvent;
  monitor: { id: string; name: string; url: string; account: string | null };
  check: {
    status: "up" | "down";
    statusCode: number | null;
    responseMs: number | null;
    error: string | null;
    checkedAt: string;
  } | null;
  sentAt: string;
}

function eventMessage(event: WebhookEvent, monitor: Pick<Monitor, "name" | "url">, check: WebhookPayload["check"]): string {
  const where = monitor.url.replace(/^https?:\/\//, "");
  if (event === "test") {
    return `PING: test notification — if you can read this, “${monitor.name}” alerts will reach this channel`;
  }
  if (event === "down") {
    const why =
      check?.statusCode != null
        ? `HTTP ${check.statusCode}`
        : check?.error
          ? check.error
          : "request failed";
    return `PING: DOWN — “${monitor.name}” (${where}) failed its check: ${why}`;
  }
  if (event === "slow") {
    const ms = check?.responseMs != null ? ` in ${check.responseMs} ms` : "";
    return `PING: SLOW — “${monitor.name}” (${where}) responded${ms}, above its latency threshold`;
  }
  const ms = check?.responseMs != null ? ` in ${check.responseMs} ms` : "";
  const code = check?.statusCode != null ? ` (HTTP ${check.statusCode})` : "";
  return `PING: UP — “${monitor.name}” (${where}) is back${code}${ms}`;
}

export function buildWebhookPayload(
  event: WebhookEvent,
  monitor: Pick<Monitor, "id" | "name" | "url" | "account">,
  check: WebhookPayload["check"],
): WebhookPayload {
  const message = eventMessage(event, monitor, check);
  return {
    text: message,
    content: message,
    event,
    monitor: { id: monitor.id, name: monitor.name, url: monitor.url, account: monitor.account },
    check,
    sentAt: new Date().toISOString(),
  };
}

export interface DeliveryResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  ms: number;
}

/**
 * SSRF defense: rejects webhook URLs that point at the loopback, RFC1918
 * private ranges, link-local (cloud metadata endpoints), IPv6 ULA or bare
 * hostnames. Channel creation is admin-gated, but the guard also runs at
 * delivery time so rows saved before this check (or crafted directly in
 * the DB) can never make PING probe internal infrastructure.
 */
export function isPrivateWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".localhost") || h === "metadata.google.internal") {
      return true;
    }
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h) || h === "0.0.0.0") return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd")) return true;
    if (!h.includes(".")) return true; // bare/internal hostname
    return false;
  } catch {
    return true;
  }
}
/** Sends one payload to one URL. Never throws. Private targets are refused. */
export async function deliverWebhook(url: string, payload: WebhookPayload): Promise<DeliveryResult> {
  if (isPrivateWebhookUrl(url)) {
    return {
      ok: false,
      statusCode: null,
      error: "Blocked: webhook URL points at a private/internal address",
      ms: 0,
    };
  }
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "user-agent": "PING/1.0 (uptime monitor webhooks)",
      },
      body: JSON.stringify(payload),
    });
    // Release the body without downloading it.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    const ms = Math.round(performance.now() - started);
    if (res.ok) {
      return { ok: true, statusCode: res.status, error: null, ms };
    }
    return {
      ok: false,
      statusCode: res.status,
      error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
      ms,
    };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const reason =
      err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `Timed out after ${WEBHOOK_TIMEOUT_MS / 1000}s`
        : (err?.message ?? "Request failed").slice(0, 200);
    return { ok: false, statusCode: null, error: reason, ms: Math.round(performance.now() - started) };
  }
}

/**
 * Fires an up/down/slow/test event to every enabled channel subscribed to that
 * event AND routed to this monitor (channels with a monitorId only receive
 * that monitor's events; null receives everything), updating each channel's
 * honest last-attempt stats. Fire-and-forget safe: callers may `void` it;
 * it never rejects.
 */
export async function fireWebhooks(
  event: WebhookEvent,
  monitor: Pick<Monitor, "id" | "name" | "url" | "account">,
  check: WebhookPayload["check"],
): Promise<{ notified: number }> {
  try {
    const eventFlag: Record<Exclude<WebhookEvent, "test">, string> = {
      down: "notifyDown",
      up: "notifyUp",
      slow: "notifySlow",
    };
    const where =
      event === "test"
        ? { enabled: true, OR: [{ monitorId: null }, { monitorId: monitor.id }] }
        : {
            enabled: true,
            [eventFlag[event]]: true,
            OR: [{ monitorId: null }, { monitorId: monitor.id }],
          };
    const channels = await db.webhookChannel.findMany({ where });
    if (channels.length === 0) return { notified: 0 };

    const payload = buildWebhookPayload(event, monitor, check);
    await Promise.all(
      channels.map(async (ch) => {
        const result = await deliverWebhook(ch.url, payload);
        await db.webhookChannel
          .update({
            where: { id: ch.id },
            data: {
              deliveries: { increment: 1 },
              lastDeliveryAt: new Date(),
              lastOk: result.ok,
              lastError: result.error,
            },
          })
          .catch(() => undefined);
        if (!result.ok) {
          console.error(`[PING] webhook “${ch.name}” failed: ${result.error ?? "unknown"}`);
        }
        return result.ok;
      }),
    );
    return { notified: channels.length };
  } catch (err) {
    console.error("[PING] fireWebhooks error:", err);
    return { notified: 0 };
  }
}

/** True when a status change should raise an event. */
export function isTransition(previous: string | null | undefined, next: "up" | "down"): WebhookEvent | null {
  if (next === "down" && previous !== "down") return "down";
  if (next === "up" && previous === "down") return "up";
  return null;
}
