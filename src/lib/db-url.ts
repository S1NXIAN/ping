// Resolves a relative SQLite `file:` DATABASE_URL to an absolute path so the
// running server and `prisma db push` open the SAME database file.
//
// Prisma resolves a relative SQLite path against the schema directory. In
// `next dev` that is `<project>/prisma`; the standalone production build
// bundles a schema copy to `.next/standalone/prisma`, so the same
// `file:./db/x.db` points at two different files. The server then fails to
// open the database `db push` just created (SQLite error 14: Unable to open
// the database file).
//
// Anchoring the path at the SOURCE schema — the nearest ancestor of the
// working directory that has `prisma/schema.prisma`, skipping build output
// (`.next`) — makes both resolve identically. Absolute paths and non-`file:`
// URLs are returned unchanged.
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const FILE_PREFIX = "file:";

/** True when `p` lies inside a build-output directory (never the source tree). */
function isBuildOutput(p: string): boolean {
  return p.split(/[\\/]/).includes(".next");
}

export function resolveDatabaseUrl(
  raw: string | undefined,
  cwd: string = process.cwd(),
): string | undefined {
  if (!raw || !raw.startsWith(FILE_PREFIX)) return raw;
  const filePath = raw.slice(FILE_PREFIX.length);
  if (isAbsolute(filePath)) return raw;

  let dir = cwd;
  for (;;) {
    if (
      existsSync(join(dir, "prisma", "schema.prisma")) &&
      !isBuildOutput(dir)
    ) {
      return `${FILE_PREFIX}${resolve(dir, "prisma", filePath)}`;
    }
    const parent = dirname(dir);
    if (parent === dir) return raw; // no source schema ancestor — leave as-is
    dir = parent;
  }
}

/**
 * Pins a local SQLite `file:` URL to a single connection.
 *
 * SQLite has exactly one writer. Prisma's default pool opens several
 * connections, so two writes that overlap make the later one wait on the write
 * lock until its transaction times out (P2028/P1008) — and the caller's real
 * result is discarded. The scheduler runs checks MAX_CONCURRENCY at a time and
 * the cron tick can land on top of a create, so this collision is the normal
 * case, not an edge case. One connection serializes the writes instead of
 * letting them race. Absolute/relative/query-bearing file URLs all keep their
 * existing parameters. Non-`file:` URLs are returned unchanged.
 */
export function sqlitePoolUrl(raw: string | undefined): string | undefined {
  if (!raw || !raw.startsWith(FILE_PREFIX)) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}connection_limit=1`;
}

/**
 * Size in bytes of the SQLite file the app actually opens, or null when the
 * URL is not a local file / the file cannot be read. Resolves the path the
 * same way the server does, so the Settings readout measures the real file
 * (a raw `file:./db/x.db` stats the wrong path under the process cwd in dev).
 */
export function databaseFileSize(
  raw: string | undefined,
  cwd: string = process.cwd(),
): number | null {
  const url = resolveDatabaseUrl(raw, cwd);
  if (!url || !url.startsWith(FILE_PREFIX)) return null;
  try {
    return statSync(url.slice(FILE_PREFIX.length)).size;
  } catch {
    return null;
  }
}
