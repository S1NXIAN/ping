// Preloaded by bunfig.toml BEFORE any test module (and therefore before
// @/lib/db reads DATABASE_URL). Sets a throwaway SQLite URL and pushes the
// real schema into it. Doing this here — not inside a test module — is what
// keeps the suite from racing the static imports of @/lib/db.
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
