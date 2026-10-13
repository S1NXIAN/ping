// PING check engine — performs REAL HTTP requests and stores REAL results.
// Nothing here simulates or estimates anything.
import type { Check, Monitor } from "@prisma/client";
import { db } from "./db";
import { isTimesDue, parseTimes } from "./schedule";

export const CHECK_TIMEOUT_MS = 15_000;
export const MAX_CONCURRENCY = 5;
export const RETENTION_DAYS = 30;
export const MAX_CHECKS_PER_MONITOR = 1000;
/** Hard cap on monitors — matches the import limit; keeps tick duration and
 *  DB size sane on a free-tier instance. */
export const MAX_MONITORS = 200;
/** How much of a response body a keyword check is willing to read. */
export const KEYWORD_BODY_LIMIT_BYTES = 256 * 1024;
export const KEYWORD_MAX_LENGTH = 200;

export interface TickResult {
  ran: number;
  up: number;
  down: number;
  durationMs: number;
  at: string;
}

interface RuntimeState {
  running: boolean;
  lastTickAt: string | null;
  lastTick: TickResult | null;
  lastTickAttemptAt: number;
  schedulerStarted: boolean;
  /** When the hourly prune job last ran, and how many checks it deleted. */
  lastPrunedAt: string | null;
  lastPrunedCount: number | null;
}

/**
 * Live check-engine state — the runtime readout and the in-flight guard.
 * Held on `globalThis`, not in module scope: Next compiles the
 * instrumentation hook (which starts the scheduler) into a bundle separate
 * from the route handlers, so module-level state would be one copy per bundle
 * and the guard would not hold in the production build. Same pattern as
 * self-monitor.ts, for the same bundler reason.
 */
const g = globalThis as unknown as {
  __pingChecker?: { runtimeState: RuntimeState; inFlight: Set<string> };
};
const checkerState = (g.__pingChecker ??= {
  runtimeState: {
    running: false,
    lastTickAt: null,
    lastTick: null,
    lastTickAttemptAt: 0,
    schedulerStarted: false,
    lastPrunedAt: null,
    lastPrunedCount: null,
  },
  inFlight: new Set<string>(),
});

/** Runtime state, exposed via /api/admin/info (real values only). */
export const runtimeState = checkerState.runtimeState;

export interface RetentionPolicy {
  /** Days of check history to keep; null = keep forever. */
  days: number | null;
  /** Apply the per-monitor cap (only in the default policy). */
  cap: boolean;
}

/**
 * Resolves the configured retention policy from Settings:
 *   retentionDays = null → default: 30 days + 1,000 checks/monitor cap
 *   retentionDays = 0    → keep forever (no check deletion at all)
 *   retentionDays = N    → keep N days, no cap (explicit user choice)
 */
export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const s = await db.settings.findUnique({
    where: { id: "main" },
    select: { retentionDays: true },
  });
  if (s?.retentionDays == null) return { days: RETENTION_DAYS, cap: true };
  if (s.retentionDays === 0) return { days: null, cap: false };
  return { days: s.retentionDays, cap: false };
}

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

/**
 * Reads at most `limit` bytes of a response body as text (streamed, so a
 * huge body never gets fully buffered). Binary bodies decode lossily — that
 * is fine: keyword search still works over the decodable parts.
 */
async function readBodyUpTo(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (bytes >= limit) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  return text;
}

/**
 * Keyword evaluation — case-insensitive substring test over the first
 * 256 KB of the body. Returns null when the check passes (no error) or a
 * human-readable failure reason.
 */
function keywordFailure(
  mode: string,
  keyword: string,
  body: string,
): string | null {
  const hay = body.toLowerCase();
  const needle = keyword.toLowerCase();
  const found = hay.includes(needle);
  if (mode === "excludes") {
    return found
      ? `Response contains the excluded keyword “${keyword}”`
      : null;
  }
  return found ? null : `Keyword “${keyword}” not found in the response`;
}

/**
 * Monitor ids with a check currently executing in this process. Overlapping
 * triggers are normal (scheduler tick × manual "check now" × first check
 * after create), and without this guard they would write
 * duplicate Check rows and clobber the last-status fields via read-modify-
 * write races. Returns null when skipped. Held on `globalThis` (see
 * checkerState) so it is one set across the scheduler and the route bundles.
 */
const inFlight = checkerState.inFlight;

/** Runs one real HTTP check and persists the result. Null = skipped. */
export async function runCheck(monitor: Monitor): Promise<Check | null> {
  if (inFlight.has(monitor.id)) return null;
  inFlight.add(monitor.id);
  try {
    return await runCheckInner(monitor);
  } finally {
    inFlight.delete(monitor.id);
  }
}

async function runCheckInner(monitor: Monitor): Promise<Check> {
  const started = performance.now();
  let status: "up" | "down" = "down";
  let statusCode: number | null = null;
  let error: string | null = null;

  // A keyword check needs a response body, so HEAD can never carry one —
  // every write boundary rejects that pairing (see methodKeywordError), so
  // the stored method is used as-is here.
  const keyword = monitor.keyword?.trim() || null;
  const method = monitor.method;

  try {
    const res = await fetch(monitor.url, {
      method,
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
      if (keyword) {
        // Body read stays inside the check timeout (same AbortSignal) and
        // any transport error while reading marks the check down honestly.
        const body = await readBodyUpTo(res, KEYWORD_BODY_LIMIT_BYTES);
        const kwError = keywordFailure(monitor.keywordMode, keyword, body);
        if (kwError) {
          status = "down";
          error = kwError;
        }
      } else {
        // Release the body without fully downloading it — status line is enough.
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
      }
    } else {
      status = "down";
      error = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
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
 * previous result, and only genuinely due monitors are checked. The overlap
 * guard (runtimeState.running) and the in-flight guard are process-wide
 * (globalThis), so the scheduler and the route handlers share one copy.
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
    // Two cadence modes. Interval monitors get a small grace so ticks at
    // exactly the interval boundary don't skip. Times-of-day monitors use
    // bounded catch-up instead: due when the most recent scheduled instant
    // has passed and the last check predates it, so a wake after several
    // missed scheduled instants runs ONE check (the latest), never a backlog.
    const due = monitors.filter((m) => {
      if (m.scheduleMode === "times") {
        const times = parseTimes(m.scheduleTimes);
        if (times.length === 0) return false; // nothing scheduled
        return isTimesDue(times, m.timezone ?? "UTC", m.lastCheckAt?.getTime() ?? null, now);
      }
      return !m.lastCheckAt || now - m.lastCheckAt.getTime() >= (m.intervalSec - 5) * 1000;
    });

    let ran = 0;
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
        if (!r) continue; // already in flight elsewhere — nothing was run
        ran += 1;
        if (r.status === "up") up += 1;
        else down += 1;
      }
    }

    const result: TickResult = {
      ran,
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

/**
 * Prunes old checks according to the configured retention policy (see
 * getRetentionPolicy) and drops expired sessions. Operational hygiene rows
 * (sessions) are always cleaned — only check history respects the retention
 * setting.
 */
export async function pruneChecks(): Promise<{ deleted: number }> {
  const policy = await getRetentionPolicy();
  let deleted = 0;

  if (policy.days != null) {
    const cutoff = new Date(Date.now() - policy.days * 24 * 60 * 60 * 1000);
    const old = await db.check.deleteMany({ where: { checkedAt: { lt: cutoff } } });
    deleted += old.count;
  }

  if (policy.cap) {
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
        deleted += r.count;
      }
    }
  }

  // Incident notes older than the incident lookback can never match a derived
  // incident again — tied to the fixed lookback, not the retention setting.
  await db.incidentNote.deleteMany({
    where: { startedAt: { lt: new Date(Date.now() - (RETENTION_DAYS + 2) * 86400_000) } },
  });

  runtimeState.lastPrunedAt = new Date().toISOString();
  runtimeState.lastPrunedCount = deleted;
  return { deleted };
}

/** Next free manual-order position for a new monitor (appends at the end).
 *  Accepts a transaction client so an import can compute it inside its tx. */
export async function nextMonitorPosition(
  client: Pick<typeof db, "monitor"> = db,
): Promise<number> {
  const agg = await client.monitor.aggregate({ _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}
