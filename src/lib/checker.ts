// PING check engine — performs REAL HTTP requests and stores REAL results.
// Nothing here simulates or estimates anything.
import type { Monitor } from "@prisma/client";
import { db } from "./db";

export const CHECK_TIMEOUT_MS = 15_000;
export const MAX_CONCURRENCY = 5;
export const RETENTION_DAYS = 30;
export const MAX_CHECKS_PER_MONITOR = 1000;

export interface TickResult {
  ran: number;
  up: number;
  down: number;
  durationMs: number;
  at: string;
}

/** Module-level runtime state, exposed via /api/admin/info (real values only). */
export const runtimeState = {
  running: false,
  lastTickAt: null as string | null,
  lastTick: null as TickResult | null,
  lastTickAttemptAt: 0,
  schedulerStarted: false,
};

function describeError(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  const name = err?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError" || name === "TimeoutSignalError") {
    return `Timed out after ${CHECK_TIMEOUT_MS / 1000}s`;
  }
  const code = err?.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS lookup failed";
  if (code === "ECONNREFUSED") return "Connection refused";
  if (code === "ECONNRESET") return "Connection reset";
  if (code === "ECONNABORTED") return "Connection aborted";
  if (code === "CERT_HAS_EXPIRED") return "TLS certificate expired";
  if (typeof code === "string" && code.startsWith("ERR_TLS")) return `TLS error (${code})`;
  if (code === "UND_ERR_CONNECT_TIMEOUT") return "Connection timed out";
  if (code) return `Network error (${code})`;
  return (err?.message ?? "Request failed").slice(0, 200);
}

/** Runs one real HTTP check and persists the result. */
export async function runCheck(monitor: Monitor) {
  const started = performance.now();
  let status: "up" | "down" = "down";
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(monitor.url, {
      method: monitor.method,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: {
        "user-agent": "PING/1.0 (uptime monitor; keeps idle services awake)",
        accept: "*/*",
      },
    });
    statusCode = res.status;
    if (res.status >= 200 && res.status < 400) {
      status = "up";
    } else {
      status = "down";
      error = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    }
    // Release the body without fully downloading it — status line is enough.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
  } catch (e) {
    status = "down";
    error = describeError(e);
  }

  const responseMs = Math.round(performance.now() - started);
  const check = await db.check.create({
    data: {
      monitorId: monitor.id,
      status,
      statusCode,
      responseMs,
      error: error ? error.slice(0, 200) : null,
    },
  });
  await db.monitor.update({
    where: { id: monitor.id },
    data: {
      lastCheckAt: check.checkedAt,
      lastStatus: status,
      lastStatusCode: statusCode,
      lastResponseMs: responseMs,
      lastError: error ? error.slice(0, 200) : null,
    },
  });
  return check;
}

/**
 * Runs checks for every enabled monitor whose interval has elapsed.
 * Safe to call concurrently / repeatedly — overlapping runs return the
 * previous result, and only genuinely due monitors are checked.
 */
export async function runDueChecks(): Promise<TickResult> {
  if (runtimeState.running) {
    return (
      runtimeState.lastTick ?? {
        ran: 0,
        up: 0,
        down: 0,
        durationMs: 0,
        at: new Date().toISOString(),
      }
    );
  }
  runtimeState.running = true;
  try {
    const started = performance.now();
    const now = Date.now();
    const monitors = await db.monitor.findMany({ where: { enabled: true } });
    // small grace so ticks at exactly interval boundary don't skip
    const due = monitors.filter(
      (m) => !m.lastCheckAt || now - m.lastCheckAt.getTime() >= (m.intervalSec - 5) * 1000,
    );

    let up = 0;
    let down = 0;
    for (let i = 0; i < due.length; i += MAX_CONCURRENCY) {
      const batch = due.slice(i, i + MAX_CONCURRENCY);
      const results = await Promise.all(
        batch.map((m) =>
          runCheck(m).catch((err) => {
            console.error(`[PING] check error for "${m.name}":`, err);
            return null;
          }),
        ),
      );
      for (const r of results) {
        if (!r) continue;
        if (r.status === "up") up += 1;
        else down += 1;
      }
    }

    const result: TickResult = {
      ran: due.length,
      up,
      down,
      durationMs: Math.round(performance.now() - started),
      at: new Date().toISOString(),
    };
    runtimeState.lastTickAt = result.at;
    runtimeState.lastTick = result;
    if (result.ran > 0) {
      console.log(
        `[PING] tick: ran ${result.ran} checks (${up} up / ${down} down) in ${result.durationMs}ms`,
      );
    }
    return result;
  } finally {
    runtimeState.running = false;
  }
}

/** Prunes old checks (retention) and per-monitor caps; also drops expired sessions. */
export async function pruneChecks(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = await db.check.deleteMany({ where: { checkedAt: { lt: cutoff } } });
  let capped = 0;

  const monitors = await db.monitor.findMany({ select: { id: true } });
  for (const m of monitors) {
    const count = await db.check.count({ where: { monitorId: m.id } });
    if (count > MAX_CHECKS_PER_MONITOR) {
      const keep = await db.check.findMany({
        where: { monitorId: m.id },
        orderBy: { checkedAt: "desc" },
        take: MAX_CHECKS_PER_MONITOR,
        select: { id: true },
      });
      const r = await db.check.deleteMany({
        where: { monitorId: m.id, id: { notIn: keep.map((k) => k.id) } },
      });
      capped += r.count;
    }
  }

  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { deleted: old.count + capped };
}
