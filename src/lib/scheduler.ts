// PING background scheduler: checks due monitors every 30 s and prunes
// old data hourly. Started once from instrumentation.ts and guarded so
// hot reloads never spawn duplicates.
import { pruneChecks, runDueChecks, runtimeState } from "./checker";

export const TICK_INTERVAL_SEC = 30;

export function startScheduler() {
  const g = globalThis as unknown as { __pingSchedulerStarted?: boolean };
  if (g.__pingSchedulerStarted || runtimeState.schedulerStarted) return;
  g.__pingSchedulerStarted = true;
  runtimeState.schedulerStarted = true;

  console.log(`[PING] scheduler started — checking due monitors every ${TICK_INTERVAL_SEC}s`);
  runtimeState.schedulerStarted = true;

  const tick = async () => {
    try {
      await runDueChecks();
    } catch (e) {
      console.error("[PING] scheduler tick failed:", e);
    }
  };

  const prune = async () => {
    try {
      const r = await pruneChecks();
      if (r.deleted > 0) console.log(`[PING] pruned ${r.deleted} old checks`);
    } catch (e) {
      console.error("[PING] prune failed:", e);
    }
  };

  setTimeout(tick, 4000);
  setInterval(tick, TICK_INTERVAL_SEC * 1000);
  setTimeout(prune, 60_000);
  setInterval(prune, 60 * 60 * 1000);
}
