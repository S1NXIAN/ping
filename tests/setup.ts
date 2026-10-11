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

// Hermetic DNS for tests. deliverWebhook resolves webhook hostnames to reject
// private targets; tests must not depend on the network or the CI resolver, so
// node:dns/promises is mocked here (the one place that runs before every test
// module). IP literals resolve to themselves; evil.example.com resolves to
// loopback (the SSRF case under test); does-not-exist.example.org is NXDOMAIN;
// every other name resolves to a public address so ordinary delivery tests work.
import { mock } from "bun:test";

// mock.module is typed `void | Promise<void>`; registration is synchronous, so
// the result is deliberately not awaited.
void mock.module("node:dns/promises", () => ({
  lookup: async (host: string, opts?: { all?: boolean }) => {
    let ip: string | null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) ip = host;
    else if (host === "evil.example.com") ip = "127.0.0.1";
    else if (host === "does-not-exist.example.org") ip = null;
    else ip = "1.2.3.4";
    if (!ip) {
      const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
        code: "ENOTFOUND",
      });
      throw err;
    }
    const record = { address: ip, family: 4 as const };
    return opts?.all ? [record] : record;
  },
}));
