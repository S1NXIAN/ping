// Next.js instrumentation hook — runs once when the server process boots.
// Starts PING's in-process check scheduler and ensures the Self-monitor
// exists (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
  const { ensureSelfMonitorOnBoot } = await import("./lib/self-monitor");
  await ensureSelfMonitorOnBoot();
  // Repair: monitors written before the method/keyword rule existed may hold
  // HEAD + keyword, which would run as HEAD, find no body and record a
  // permanent false down. Normalise them to GET on every boot (idempotent —
  // a no-op once none remain, and the boundaries now reject new ones).
  const { db } = await import("./lib/db");
  await db.monitor.updateMany({
    where: { method: "HEAD", keyword: { not: null } },
    data: { method: "GET" },
  });
}
