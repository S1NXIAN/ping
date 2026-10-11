// The single-password auth and the HMAC admin-unlock token. These are the
// only things standing between a stranger and every monitor, so the failure
// directions matter: a wrong password must fail, an expired or tampered
// unlock must fail, and a fresh one must work.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  hashPassword,
  verifyPassword,
  issueUnlockToken,
  verifyUnlockToken,
  ADMIN_LOCKED_MSG,
} from "@/lib/ping-auth";

test("a correct password verifies and a wrong one does not", () => {
  const { hash, salt } = hashPassword("correct horse battery staple");
  expect(verifyPassword("correct horse battery staple", hash, salt)).toBe(true);
  expect(verifyPassword("wrong password", hash, salt)).toBe(false);
});

test("the same password hashed twice yields different hashes (random salt)", () => {
  const a = hashPassword("same");
  const b = hashPassword("same");
  expect(a.hash).not.toBe(b.hash);
  expect(a.salt).not.toBe(b.salt);
  // …but both still verify the password.
  expect(verifyPassword("same", a.hash, a.salt)).toBe(true);
  expect(verifyPassword("same", b.hash, b.salt)).toBe(true);
});

test("a fresh unlock token verifies and carries its expiry", () => {
  const { hash } = hashPassword("pw");
  const { token, expiresAt } = issueUnlockToken(hash);
  const verified = verifyUnlockToken(token, hash);
  expect(verified?.getTime()).toBe(expiresAt.getTime());
});

test("an unlock token signed with a different password hash is rejected", () => {
  const { hash: hashA } = hashPassword("pw-a");
  const { hash: hashB } = hashPassword("pw-b");
  const { token } = issueUnlockToken(hashA);
  // The key is derived from the password hash, so a password change kills it.
  expect(verifyUnlockToken(token, hashB)).toBeNull();
});

test("a tampered signature is rejected", () => {
  const { hash } = hashPassword("pw");
  const { token } = issueUnlockToken(hash);
  const dot = token.indexOf(".");
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
  expect(verifyUnlockToken(`${exp}.${flipped}`, hash)).toBeNull();
});

test("an expired unlock token is rejected", () => {
  const { hash } = hashPassword("pw");
  const { token, expiresAt } = issueUnlockToken(hash);
  expect(verifyUnlockToken(token, hash)).not.toBeNull(); // valid now
  // Move the clock past the 15-minute TTL: the same token must now be refused.
  setSystemTime(new Date(expiresAt.getTime() + 1000));
  expect(verifyUnlockToken(token, hash)).toBeNull();
  setSystemTime();
});

afterEach(() => {
  setSystemTime();
});

test("a malformed or missing token is rejected", () => {
  const { hash } = hashPassword("pw");
  expect(verifyUnlockToken(undefined, hash)).toBeNull();
  expect(verifyUnlockToken("", hash)).toBeNull();
  expect(verifyUnlockToken("no-dot", hash)).toBeNull();
  expect(verifyUnlockToken(".sigonly", hash)).toBeNull();
  expect(verifyUnlockToken("notanumber.abc", hash)).toBeNull();
});

test("the admin-locked message is a stable constant the client matches on", () => {
  expect(ADMIN_LOCKED_MSG).toBe("Admin locked — unlock Settings with your password");
});
