// Password hashing must not block the event loop. scryptSync freezes every
// other request for the ~65 ms it runs; the async scrypt hands the work to the
// thread pool instead. The stored format must be unchanged — a hash written by
// the OLD synchronous implementation has to verify with the new async one, or
// every existing install is locked out.
import { expect, test } from "bun:test";
import { scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/ping-auth";

test("hashPassword is async and yields a verifying hash", async () => {
  const { hash, salt } = await hashPassword("correct horse battery staple");
  expect(typeof hash).toBe("string");
  expect(typeof salt).toBe("string");
  expect(await verifyPassword("correct horse battery staple", hash, salt)).toBe(true);
});

test("verifyPassword rejects a wrong password", async () => {
  const { hash, salt } = await hashPassword("correct horse battery staple");
  expect(await verifyPassword("wrong password", hash, salt)).toBe(false);
});

test("a hash written by the old synchronous implementation still verifies", async () => {
  // The old code was `scryptSync(password, salt, 64).toString("hex")`. Reproduce
  // it independently here, so the async rewrite is proven to keep the on-disk
  // format — not merely to round-trip with itself.
  const salt = "0123456789abcdef0123456789abcdef";
  const legacyHash = scryptSync("legacy-password", salt, 64).toString("hex");
  expect(await verifyPassword("legacy-password", legacyHash, salt)).toBe(true);
  expect(await verifyPassword("not-the-password", legacyHash, salt)).toBe(false);
  // And the new async hash is the same bytes for the same inputs.
  const { hash } = await hashPassword("legacy-password", salt);
  expect(hash).toBe(legacyHash);
  expect(hash).toHaveLength(128); // 64 bytes, hex
});

test("hashing does not block a concurrent timer", async () => {
  // A synchronous scrypt freezes the event loop for the whole ~65 ms, so a
  // timer scheduled first would still fire last. The async form hands the work
  // to the thread pool and lets the timer fire while hashing is in flight.
  const order: string[] = [];
  const hashing = hashPassword("some-password").then(() => order.push("hash"));
  const timer = new Promise<void>((r) =>
    setTimeout(() => {
      order.push("timer");
      r();
    }, 5),
  );
  await Promise.all([timer, hashing]);
  expect(order).toEqual(["timer", "hash"]);
});
