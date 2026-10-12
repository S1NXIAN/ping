// The Self-monitor: one monitor PING creates to check its own health
// endpoint. It is an ordinary monitor otherwise — visible, editable and
// deletable — and a durable `isSelfMonitor` marker keeps creation idempotent
// so repeated boots never make a second one. Deleting it sets a durable
// `selfMonitorDisabled` flag, so it is never recreated against the operator's
// wishes.
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
/** Deterministic id: a second create with the same id fails on the primary
 *  key, so concurrent creators (boot vs. setup vs. a duplicated instance)
 *  can never insert two Self-monitors. */
export const SELF_MONITOR_ID = "self-monitor";

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

/** The platform's external-URL env var as an origin, or null when unset. */
function envOrigin(): string | null {
  return process.env.RENDER_EXTERNAL_URL?.trim() || null;
}

/**
 * Creates the Self-monitor for `origin` unless one already exists or the
 * operator disabled it. Idempotent two ways: the deterministic id makes a
 * concurrent create fail on the primary key (swallowed), and the
 * `isSelfMonitor` check skips a create when it is already there.
 */
export async function ensureSelfMonitor(origin: string | null | undefined): Promise<void> {
  const url = selfMonitorUrl(origin);
  if (!url) return;
  if (await selfMonitorDisabled()) return;
  const existing = await db.monitor.findFirst({
    where: { isSelfMonitor: true },
    select: { id: true },
  });
  if (existing) return;
  try {
    await db.monitor.create({
      data: {
        id: SELF_MONITOR_ID,
        name: SELF_MONITOR_NAME,
        url,
        intervalSec: SELF_MONITOR_INTERVAL_SEC,
        isSelfMonitor: true,
        position: await nextMonitorPosition(),
      },
    });
  } catch (e) {
    // A concurrent creator won the primary-key race — that is the idempotent
    // outcome, not an error. Anything else propagates.
    if (!isUniqueViolation(e)) throw e;
  }
}

/** True once the operator has deleted the Self-monitor (a durable marker). */
async function selfMonitorDisabled(): Promise<boolean> {
  const s = await db.settings.findUnique({
    where: { id: "main" },
    select: { selfMonitorDisabled: true },
  });
  return s?.selfMonitorDisabled ?? false;
}

/**
 * Records that the operator deleted the Self-monitor, so it is never
 * recreated against their wishes. Called by the monitor delete path when the
 * deleted row was the Self-monitor.
 */
export async function disableSelfMonitor(): Promise<void> {
  await db.settings.updateMany({
    where: { id: "main" },
    data: { selfMonitorDisabled: true },
  });
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Boot path: create the Self-monitor when the platform's external-URL env var
 * is present. A fresh install (no Settings row yet) is left to the setup
 * request, whose own origin is the higher-priority source — so this skips it.
 * Otherwise it arms lazy capture for the next authenticated request.
 */
export async function ensureSelfMonitorOnBoot(): Promise<void> {
  const settings = await db.settings.findUnique({ where: { id: "main" }, select: { id: true } });
  if (!settings) return; // fresh install — the setup request supplies the origin
  const origin = envOrigin();
  if (origin) {
    await ensureSelfMonitor(origin);
    return;
  }
  selfMonitorState().lazyCaptureArmed = true;
}

/**
 * Lazy path: create the Self-monitor from the first authenticated request's
 * origin, for an already-set-up install where the env var is absent. Disarms
 * only on success, so a transient failure is retried on the next request.
 */
export async function captureSelfMonitorOrigin(origin: string | null): Promise<void> {
  if (!selfMonitorState().lazyCaptureArmed || !origin) return;
  await ensureSelfMonitor(origin);
  selfMonitorState().lazyCaptureArmed = false;
}

/**
 * Lazy-capture flag, held on `globalThis`. Next compiles this module into
 * separate chunks for the instrumentation hook and the route handlers, so a
 * module-level `let` would be two instances and the boot-time arm would never
 * reach the route. The scheduler uses the same globalThis pattern for the
 * same reason.
 */
function selfMonitorState(): { lazyCaptureArmed: boolean } {
  const g = globalThis as unknown as { __pingSelfMonitor?: { lazyCaptureArmed: boolean } };
  g.__pingSelfMonitor ??= { lazyCaptureArmed: false };
  return g.__pingSelfMonitor;
}
