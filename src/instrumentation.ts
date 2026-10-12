// Next.js instrumentation hook — runs once when the server process boots.
// Starts PING's in-process check scheduler and ensures the Self-monitor
// exists (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
  const { ensureSelfMonitorOnBoot } = await import("./lib/self-monitor");
  await ensureSelfMonitorOnBoot();
}
