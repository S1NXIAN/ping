// The public status-page token is compared in constant time on five surfaces
// (status page, badge, feed, OG card, page metadata). The compare must be by
// BYTE length, not JavaScript string length: Buffer.from measures bytes, so a
// multi-byte token whose CHARACTER count matches the stored token would make
// timingSafeEqual throw and turn the intended 404 into a 500.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { matchesStatusToken } from "@/lib/ping-auth";

const STORED = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"; // 48 hex chars

test("accepts the exact token", () => {
  expect(matchesStatusToken(STORED, STORED)).toBe(true);
});

test("rejects a different token", () => {
  expect(matchesStatusToken("b".repeat(48), STORED)).toBe(false);
});

test("a multi-byte token of the same character count is rejected, not a crash", () => {
  const crafted = "é".repeat(STORED.length); // 48 chars, 96 bytes
  expect(crafted.length).toBe(STORED.length);
  expect(matchesStatusToken(crafted, STORED)).toBe(false);
});

test("a missing stored token never matches", () => {
  expect(matchesStatusToken("x", null)).toBe(false);
  expect(matchesStatusToken("x", undefined)).toBe(false);
  expect(matchesStatusToken("", "")).toBe(false);
});

beforeEach(async () => {
  await resetDb();
});

test("a crafted multi-byte token gets the same 404 as any wrong token (no 500)", async () => {
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s", statusToken: STORED },
  });
  const { GET } = await import("@/app/api/public/status/route");
  const crafted = encodeURIComponent("é".repeat(STORED.length));
  const res = await GET(new NextRequest(`http://localhost/api/public/status?token=${crafted}`));
  expect(res.status).toBe(404);
});

test("the real token is served", async () => {
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s", statusToken: STORED },
  });
  const { GET } = await import("@/app/api/public/status/route");
  const res = await GET(new NextRequest(`http://localhost/api/public/status?token=${STORED}`));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.summary.total).toBe(0);
});
