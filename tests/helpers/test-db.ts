// Shared test harness. DATABASE_URL is set (and the schema pushed) by the
// preloaded tests/setup.ts, which runs before this module — so @/lib/db
// always points at the throwaway test database. This module just exposes it
// and a reset helper for per-test isolation.
export const db = (await import("@/lib/db")).db;

/** Wipes every table between tests (children before parents for FK order). */
export async function resetDb() {
  await db.check.deleteMany();
  await db.scheduledPing.deleteMany();
  await db.incidentNote.deleteMany();
  await db.maintenanceWindow.deleteMany();
  await db.webhookChannel.deleteMany();
  await db.monitor.deleteMany();
  await db.folder.deleteMany();
  await db.session.deleteMany();
  await db.settings.deleteMany();
}
