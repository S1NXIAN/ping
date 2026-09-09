// PING check engine — performs REAL HTTP requests and stores REAL results.
// Nothing here simulates or estimates anything.
import type { Monitor } from "@prisma/client";
import { db } from "./db";
import { fireWebhooks, isTransition } from "./webhooks";

export const CHECK_TIMEOUT_MS = 15_000;
export const MAX_CONCURRENCY = 5;
export const RETENTION_DAYS = 30;
export const MAX_CHECKS_PER_MONITOR = 1000;
export const SCHEDULED_PING_RETENTION_DAYS = 7;
export const MAINTENANCE_RETENTION_DAYS = 7;
export const MAX_WINDOWS_PER_MONITOR = 10;
export const MAX_WINDOWS_TOTAL = 50;

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
  pingsRunning: false,
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

/** True while `monitorId` is inside an active maintenance window right now. */
export async function isUnderMaintenance(monitorId: string, now = new Date()): Promise<boolean> {
  const n = await db.maintenanceWindow.count({
    where: { monitorId, startsAt: { lte: now }, endsAt: { gte: now } },
  });
  return n > 0;
}

/** Runs one real HTTP check and persists the result. */
export async function runCheck(monitor: Monitor) {
  const previousStatus = monitor.lastStatus; // captured BEFORE the check runs
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

  // Notification logic — maintenance-aware. lastNotifiedStatus is the last
  // status a webhook was actually sent for. It diverges from lastStatus while
  // a maintenance window suppresses events, so a service that went down
  // during maintenance (and stayed down) still raises "down" on the first
  // check AFTER the window ends. Downtime itself is always recorded honestly.
  const effectivePrevious = monitor.lastNotifiedStatus ?? previousStatus;
  const event = isTransition(effectivePrevious, status);
  let lastNotifiedStatus: string | undefined;
  if (event) {
    const inMaintenance = await isUnderMaintenance(monitor.id);
    if (inMaintenance) {
      // Suppress: keep the old lastNotifiedStatus so the divergence is
      // remembered and the event re-fires once the window is over. "unknown"
      // is the sentinel for "no notification has ever been sent" — it keeps
      // a first-check event alive through a window that started before it.
      lastNotifiedStatus = monitor.lastNotifiedStatus ?? previousStatus ?? "unknown";
      console.log(
        `[PING] ${event} transition for "${monitor.name}" suppressed — active maintenance window`,
      );
    } else {
      void fireWebhooks(event, monitor, {
        status,
        statusCode,
        responseMs,
        error: error ? error.slice(0, 200) : null,
        checkedAt: check.checkedAt.toISOString(),
      });
      lastNotifiedStatus = status;
    }
  }

  await db.monitor.update({
    where: { id: monitor.id },
    data: {
      lastCheckAt: check.checkedAt,
      lastStatus: status,
      lastStatusCode: statusCode,
      lastResponseMs: responseMs,
      lastError: error ? error.slice(0, 200) : null,
      ...(lastNotifiedStatus !== undefined ? { lastNotifiedStatus } : {}),
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

/** Prunes old checks (retention) and per-monitor caps; also drops expired sessions, old scheduled-ping records and long-past maintenance windows. */
export async function pruneChecks(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = await db.check.deleteMany({ where: { checkedAt: { lt: cutoff } } });
  let capped = 0;

  // Finished scheduled pings only matter shortly after they ran — drop old ones.
  await db.scheduledPing.deleteMany({
    where: { status: "done", ranAt: { lt: new Date(Date.now() - SCHEDULED_PING_RETENTION_DAYS * 86400_000) } },
  });

  // Maintenance windows that ended more than a week ago are no longer useful.
  await db.maintenanceWindow.deleteMany({
    where: { endsAt: { lt: new Date(Date.now() - MAINTENANCE_RETENTION_DAYS * 86400_000) } },
  });

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

/**
 * Runs every pending scheduled ping whose time has come. Each result is a
 * REAL check: it is written to the Check table (so it counts in history and
 * stats) and the scheduled-ping row is updated with the outcome. Runs even
 * for paused monitors — an explicitly scheduled ping is user intent.
 *
 * Statuses: pending → running → done. Rows stuck in "running" (e.g. the
 * process died mid-run) are picked up again on the next tick. A module-level
 * guard stops overlapping runs inside this process.
 */
export async function runDueScheduledPings(): Promise<{ ran: number }> {
  if (runtimeState.pingsRunning) return { ran: 0 };
  runtimeState.pingsRunning = true;
  try {
    const now = Date.now();
    // small grace so a ping whose runAt is within a few seconds still fires
    const due = await db.scheduledPing.findMany({
      where: {
        OR: [
          { status: "pending", runAt: { lte: new Date(now + 5_000) } },
          { status: "running" }, // stale claim from a crashed run — re-run
        ],
      },
      orderBy: { runAt: "asc" },
      take: 25,
    });
    if (due.length === 0) return { ran: 0 };

    const monitorIds = [...new Set(due.map((p) => p.monitorId))];
    const monitors = await db.monitor.findMany({ where: { id: { in: monitorIds } } });
    const monitorById = new Map(monitors.map((m) => [m.id, m]));

    let ran = 0;
    for (let i = 0; i < due.length; i += MAX_CONCURRENCY) {
      const batch = due.slice(i, i + MAX_CONCURRENCY);
      await Promise.all(
        batch.map(async (ping) => {
          // Claim the row so a concurrent trigger can't run it twice.
          const claimed = await db.scheduledPing.updateMany({
            where: { id: ping.id, status: ping.status },
            data: { status: "running" },
          });
          if (claimed.count === 0) return;

          const monitor = monitorById.get(ping.monitorId);
          if (!monitor) {
            // monitor vanished between query and run — drop the ping
            await db.scheduledPing.delete({ where: { id: ping.id } });
            return;
          }
          const check = await runCheck(monitor).catch((err) => {
            console.error(`[PING] scheduled ping for "${monitor.name}" failed:`, err);
            return null;
          });
          // runCheck already persisted a Check row; record the outcome on the
          // ping. A null check means an internal error, not a down site.
          await db.scheduledPing.update({
            where: { id: ping.id },
            data: {
              status: "done",
              ranAt: new Date(),
              up: check ? check.status === "up" : null,
              statusCode: check?.statusCode ?? null,
              responseMs: check?.responseMs ?? null,
              error: check?.error ?? (check ? null : "Internal error while running the scheduled ping"),
            },
          });
          ran += 1;
          console.log(
            `[PING] scheduled ping → ${monitor.name}: ${check?.status ?? "error"}${
              check?.statusCode != null ? ` (HTTP ${check.statusCode})` : ""
            }`,
          );
        }),
      );
    }
    return { ran };
  } finally {
    runtimeState.pingsRunning = false;
  }
}

/** Next free manual-order position for a new monitor (appends at the end). */
export async function nextMonitorPosition(): Promise<number> {
  const agg = await db.monitor.aggregate({ _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}
