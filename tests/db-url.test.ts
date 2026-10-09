// The running server and `prisma db push` must open the SAME SQLite file.
// Prisma resolves a relative `file:` path against the schema directory, which
// differs between `next dev` (<project>/prisma) and the standalone build
// (.next/standalone/node_modules/.prisma/client) — so `file:./db/x.db` pointed
// at two different files and the server failed with SQLite error 14.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDatabaseUrl } from "@/lib/db-url";

const projectRoot = process.cwd(); // has prisma/schema.prisma

test("pins a relative path to the schema directory (where db push writes)", () => {
  // Prisma resolves ./db/custom.db from <root>/prisma -> <root>/prisma/db/custom.db
  expect(resolveDatabaseUrl("file:./db/custom.db", projectRoot)).toBe(
    `file:${join(projectRoot, "prisma", "db", "custom.db")}`,
  );
});

test("dev and standalone resolve the same relative path identically", () => {
  // Dev runs with cwd = project root; standalone chdirs into its bundle.
  const fromDev = resolveDatabaseUrl("file:./db/custom.db", projectRoot);
  const fromStandalone = resolveDatabaseUrl(
    "file:./db/custom.db",
    join(projectRoot, ".next", "standalone"),
  );
  expect(fromStandalone).toBe(fromDev);
});

test("an absolute path is left unchanged", () => {
  const abs = "file:/var/data/ping.db";
  expect(resolveDatabaseUrl(abs, projectRoot)).toBe(abs);
});

test("a non-file URL is left unchanged", () => {
  const url = "postgresql://user:pw@host/db";
  expect(resolveDatabaseUrl(url, projectRoot)).toBe(url);
});

test("undefined passes through", () => {
  expect(resolveDatabaseUrl(undefined, projectRoot)).toBeUndefined();
});

test("no schema ancestor -> left unchanged (never invents a path)", () => {
  const orphan = mkdtempSync(join(tmpdir(), "ping-noschema-"));
  const raw = "file:./db/custom.db";
  expect(resolveDatabaseUrl(raw, orphan)).toBe(raw);
});

test("skips a schema copy inside build output (.next/standalone)", () => {
  // The standalone bundle carries its own prisma/schema.prisma; resolving
  // against it would point at a file db push never created. The source
  // schema (skipping .next) must win, so both modes agree.
  const fromDev = resolveDatabaseUrl("file:./db/custom.db", projectRoot);
  const fromStandalone = resolveDatabaseUrl(
    "file:./db/custom.db",
    join(projectRoot, ".next", "standalone"),
  );
  expect(fromStandalone).toBe(fromDev);
  expect(fromStandalone).not.toContain(".next");
});
