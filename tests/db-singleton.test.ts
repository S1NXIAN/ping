// One process must use ONE PrismaClient. Next compiles the scheduler, the cron
// route and every API route into separate server chunks, so a module-level
// singleton is one copy per bundle. The shared instance therefore has to live on
// globalThis — in production too, where the dev-only cache guard used to be
// compiled out and every chunk opened its own SQLite connection (multiplying
// write-lock contention and memory on a 512 MB instance). The checker's
// in-flight guard uses the same globalThis pattern for the same reason.
import { afterEach, expect, test } from "bun:test";

const realEnv = process.env.NODE_ENV;
const g = globalThis as unknown as { prisma?: unknown };
// NODE_ENV is declared readonly in @types/node; write it through a mutable view.
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  env.NODE_ENV = realEnv;
  delete g.prisma;
});

test("two cold module copies share one PrismaClient in production", async () => {
  delete g.prisma; // start from a cold process
  env.NODE_ENV = "production";
  // Two fresh instances, like two server bundles booting in one process. (The
  // plain "@/lib/db" specifier may already be cached by an earlier test, which
  // is not the cold-boot case this guards.)
  // @ts-expect-error — a query suffix is a Bun-only specifier: it yields a
  // second module instance, which is how we reproduce the two bundles.
  const a = await import("@/lib/db?bust=coldA");
  // @ts-expect-error — see above.
  const b = await import("@/lib/db?bust=coldB");
  expect(b.db).toBe(a.db);
});

test("the shared client is reachable on globalThis in production", async () => {
  delete g.prisma;
  env.NODE_ENV = "production";
  // @ts-expect-error — see above.
  const a = await import("@/lib/db?bust=coldC");
  // A later bundle reads the cache instead of constructing again.
  expect(g.prisma).toBe(a.db);
});
