import { PrismaClient } from '@prisma/client'
import { resolveDatabaseUrl } from './db-url'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Pin a relative SQLite path to the source schema dir so this server and
// `prisma db push` open the same file (see db-url.ts). Without it the
// standalone build resolves `file:./db/x.db` against its bundled schema copy
// and fails with SQLite error 14.
const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL)

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    // Query logging is a dev aid. In production every bound parameter (incl.
    // monitor URLs) would land in platform logs, so only problems are logged.
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db