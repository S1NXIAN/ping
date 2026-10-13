// The check engine's runtime guards must be process-wide, not per-bundle.
// Next compiles instrumentation.ts (which starts the scheduler) into a bundle
// separate from the route handlers, so a module-level Set/object is one copy
// per bundle and the guards do not hold in the production build. Simulate the
// two copies by importing the module under two specifiers.
import { afterEach, expect, mock, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the in-flight guard refuses a second check across module copies", async () => {
  await resetDb();
  const a = await import("@/lib/checker");
  // @ts-expect-error — a query suffix is a Bun-only specifier: it yields a
  // second module instance, which is how we reproduce the two bundles.
  const b = await import("@/lib/checker?bust=guard");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });

  // Hold the first check open on a barrier the test controls, so the second
  // call is refused deterministically rather than by a timing guess.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  globalThis.fetch = mock(async () => {
    await held;
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;

  const first = a.runCheck(m); // registers m in the guard, then blocks
  const second = b.runCheck(m); // same monitor, other copy
  release();
  const [firstCheck, secondCheck] = await Promise.all([first, second]);

  expect(firstCheck).not.toBeNull();
  expect(secondCheck).toBeNull();
});

test("runtime state written through one module copy is visible through the other", async () => {
  await resetDb();
  const a = await import("@/lib/checker");
  // @ts-expect-error — see above.
  const b = await import("@/lib/checker?bust=state");
  await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

  const result = await a.runDueChecks();
  expect(result.ran).toBe(1);
  expect(b.runtimeState.lastTickAt).toBe(result.at);
});
