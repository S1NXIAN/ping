// The Self-monitor: one monitor PING creates to check its own health
// endpoint. It is an ordinary monitor otherwise — visible, editable and
// deletable — and a durable `isSelfMonitor` marker keeps creation idempotent
// so repeated boots never make a second one.
//
// The origin is resolved in order: (1) the setup request's origin, when a
// fresh install is being set up; (2) the platform's external-URL env var
// (Render sets RENDER_EXTERNAL_URL); (3) lazily, from the first authenticated
// request that carries a host. The pure part (URL/interval from an origin) is
// separated from the database part so the edge cases are testable alone.
import type { NextRequest } from "next/server";
import { db } from "./db";
import { nextMonitorPosition } from "./checker";

export const SELF_MONITOR_NAME = "PING self-monitor";
/** 3 minutes — cheap, and frequent enough to count as inbound keep-alive. */
export const SELF_MONITOR_INTERVAL_SEC = 180;

/**
 * The health URL for a deployment origin, or null when the origin is blank.
 * Trailing slashes are normalised so an origin from a request header and one
 * from RENDER_EXTERNAL_URL build the same URL.
 */
export function selfMonitorUrl(origin: string | null | undefined): string | null {
  const trimmed = origin?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return `${trimmed}/api/health`;
}

/** This request's deployment origin, or null when it carries no host. */
export function requestOrigin(req: NextRequest): string | null {
  const host = req.headers.get("host");
  if (!host) return null;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1");
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = isLocal ? "http" : forwardedProto === "http" ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * Creates the Self-monitor for `origin` unless one already exists (idempotent
 * on the marker) or the origin is unusable. Never resurrects a monitor the
 * operator deleted mid-run — callers gate this to boot / setup / first request.
 */
export async function ensureSelfMonitor(origin: string | null | undefined): Promise<void> {
  const url = selfMonitorUrl(origin);
  if (!url) return;
  const existing = await db.monitor.findFirst({
    where: { isSelfMonitor: true },
    select: { id: true },
  });
  if (existing) return;
  await db.monitor.create({
    data: {
      name: SELF_MONITOR_NAME,
      url,
      intervalSec: SELF_MONITOR_INTERVAL_SEC,
      isSelfMonitor: true,
      position: await nextMonitorPosition(),
    },
  });
}

// In-memory: the lazy path stays armed until the first authenticated request
// supplies an origin, then disarms. A restart re-arms it — intended, since a
// fresh boot is exactly when an install with no env var needs the capture.
let lazyCaptureArmed = false;

/**
 * Boot path: create the Self-monitor when the platform's external-URL env var
 * is present; otherwise arm lazy capture for the next authenticated request.
 */
export async function ensureSelfMonitorOnBoot(): Promise<void> {
  const envOrigin = process.env.RENDER_EXTERNAL_URL?.trim();
  if (envOrigin) {
    await ensureSelfMonitor(envOrigin);
    return;
  }
  lazyCaptureArmed = true;
}

/**
 * Lazy path: create the Self-monitor from the first authenticated request's
 * origin, for an already-set-up install where the env var is absent. No-op
 * once disarmed or when a self-monitor already exists.
 */
export async function captureSelfMonitorOrigin(origin: string | null): Promise<void> {
  if (!lazyCaptureArmed || !origin) return;
  lazyCaptureArmed = false;
  await ensureSelfMonitor(origin);
}
