// The login throttle's counters must be process-wide, not per-bundle. Next
// compiles /api/auth/login and /api/auth/setup into separate server chunks, so
// module-level state is one copy per bundle and a guess spent against one route
// would not count against the other. The checker holds its in-flight guard on
// globalThis for the same reason; the throttle follows that pattern.
import { afterEach, expect, test } from "bun:test";
import { MAX_GLOBAL_ATTEMPTS, resetThrottle, tooManyAttempts } from "@/lib/ping-auth";

afterEach(() => {
  resetThrottle();
});

test("an attempt recorded through one module copy counts in another", async () => {
  resetThrottle();
  const a = await import("@/lib/ping-auth");
  // @ts-expect-error — a query suffix is a Bun-only specifier: it yields a
  // second module instance, which is how we reproduce the two bundles.
  const b = await import("@/lib/ping-auth?bust=throttle");

  // Spend the whole per-IP allowance through copy A…
  for (let i = 0; i < a.MAX_ATTEMPTS; i++) a.recordAttempt("1.2.3.4");
  // …and copy B must see it, not a fresh empty bucket.
  expect(b.tooManyAttempts("1.2.3.4")).toBe(true);
});

test("the global ceiling is shared across module copies", async () => {
  resetThrottle();
  const a = await import("@/lib/ping-auth");
  // @ts-expect-error — see above.
  const b = await import("@/lib/ping-auth?bust=throttle2");

  for (let i = 0; i < a.MAX_GLOBAL_ATTEMPTS; i++) a.recordAttempt(`ip-${i}`);
  expect(b.tooManyAttempts("brand-new-ip")).toBe(true);
});

test("resetThrottle clears the shared state for every copy", async () => {
  const a = await import("@/lib/ping-auth");
  // @ts-expect-error — see above.
  const b = await import("@/lib/ping-auth?bust=throttle3");

  a.recordAttempt("9.9.9.9");
  expect(b.tooManyAttempts("9.9.9.9")).toBe(false); // one attempt, under the cap
  a.resetThrottle();
  expect(tooManyAttempts("9.9.9.9")).toBe(false);
  expect(MAX_GLOBAL_ATTEMPTS).toBeGreaterThan(0);
});
