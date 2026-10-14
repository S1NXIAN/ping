// Check-history retention: the configured policy, and the pruner that applies
// it. Split out of checker.ts — the check engine and data retention are
// different jobs that change for different reasons (the engine for a check
// behaviour, this for how long history is kept).
import { db } from "./db";
import { runtimeState } from "./checker";
import { INCIDENT_LOOKBACK_DAYS } from "./incidents";

/** Default days of check history to keep (the "default" policy). */
const RETENTION_DAYS = 30;
/** Per-monitor cap applied only by the default policy. */
export const MAX_CHECKS_PER_MONITOR = 1000;

interface RetentionPolicy {
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
async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const s = await db.settings.findUnique({
    where: { id: "main" },
    select: { retentionDays: true },
  });
  if (s?.retentionDays == null) return { days: RETENTION_DAYS, cap: true };
  if (s.retentionDays === 0) return { days: null, cap: false };
  return { days: s.retentionDays, cap: false };
}

/**
 * Prunes old check history according to the configured retention policy (see
 * getRetentionPolicy) and drops incident notes past the incident lookback.
 * Only check history respects the retention setting; the note cleanup is tied
 * to the fixed lookback. (Expired sessions are cleaned in ping-auth.ts.)
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
  // incident again — tied to that fixed window, not the retention setting.
  await db.incidentNote.deleteMany({
    where: { startedAt: { lt: new Date(Date.now() - INCIDENT_LOOKBACK_DAYS * 86400_000) } },
  });

  runtimeState.lastPrunedAt = new Date().toISOString();
  runtimeState.lastPrunedCount = deleted;
  return { deleted };
}
