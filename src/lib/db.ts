import { PrismaClient } from '@prisma/client'
import { resolveDatabaseUrl, sqlitePoolUrl } from './db-url'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Pin a relative SQLite path to the source schema dir so this server and
// `prisma db push` open the same file (see db-url.ts). Without it the
// standalone build resolves `file:./db/x.db` against its bundled schema copy
// and fails with SQLite error 14. Then pin the connection pool to one
// connection: SQLite has a single writer, so overlapping writes otherwise time
// out and their results are lost (see sqlitePoolUrl).
const databaseUrl = sqlitePoolUrl(resolveDatabaseUrl(process.env.DATABASE_URL))

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    // Query logging is a dev aid. In production every bound parameter (incl.
    // monitor URLs) would land in platform logs, so only problems are logged.
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
  })

// Cache on globalThis in EVERY environment, production included. Next compiles
// each server bundle separately, so a module-level singleton is one copy per
// bundle; without this cache the production build opens one SQLite connection
// per route (multiplying write-lock contention and memory). The same reason the
// checker holds its in-flight guard on globalThis.
globalForPrisma.prisma = db