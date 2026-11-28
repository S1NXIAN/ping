// Check-history retention: the configured policy, and the pruner that applies
// it. Split out of checker.ts — the check engine and data retention are
// different jobs that change for different reasons (the engine for a check
// behaviour, this for how long history is kept).
import { db } from "./db";
import { runtimeState } from "./checker";

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
 * getRetentionPolicy). (Old sessions are cleaned in ping-auth.ts.)
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
        // Single atomic statement so a check written concurrently cannot slip
        // between reading the keep list and deleting the rest.
        const removed = await db.$executeRaw`
          DELETE FROM "Check"
          WHERE monitorId = ${m.id}
            AND id NOT IN (
              SELECT id FROM "Check"
              WHERE monitorId = ${m.id}
              ORDER BY checkedAt DESC, id DESC
              LIMIT ${MAX_CHECKS_PER_MONITOR}
            )`;
        deleted += removed;
      }
    }
  }

  runtimeState.lastPrunedAt = new Date().toISOString();
  runtimeState.lastPrunedCount = deleted;
  return { deleted };
}
