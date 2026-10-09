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
import { existsSync } from "node:fs";
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
