// Shared test harness: one throwaway SQLite database per test process.
// Sets DATABASE_URL BEFORE @/lib/db constructs its PrismaClient, pushes the
// real schema into the temp file, and exposes a reset for per-test isolation.
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ping-test-"));
const url = `file:${join(dir, "test.db")}`;
process.env.DATABASE_URL = url;

execSync("bunx prisma db push --skip-generate --accept-data-loss", {
  env: { ...process.env, DATABASE_URL: url },
  stdio: "ignore",
});

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
