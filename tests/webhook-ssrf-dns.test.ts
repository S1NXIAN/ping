// deliverWebhook must refuse a webhook whose hostname RESOLVES to a private
// address, not only one that literally reads as private. The DNS mock lives
// in the preloaded tests/setup.ts: evil.example.com -> 127.0.0.1, IP literals
// resolve to themselves, everything else is NXDOMAIN.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { buildWebhookPayload, deliverWebhook, isPrivateIp } from "@/lib/webhooks";
import { db, resetDb } from "./helpers/test-db";
import { hashPassword, issueUnlockToken, SESSION_COOKIE, UNLOCK_COOKIE } from "@/lib/ping-auth";

const monitor = { id: "m1", name: "API", url: "https://api.example.com", account: null };
const payload = buildWebhookPayload("down", monitor, null);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a hostname resolving to loopback is refused without any request", async () => {
  let called = false;
  globalThis.fetch = mock(async () => {
    called = true;
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;

  const result = await deliverWebhook("http://evil.example.com/hook", payload);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/private|internal/i);
  expect(called).toBe(false);
});

test("a public URL that resolves to a public IP is still delivered", async () => {
  globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  // 1.2.3.4 resolves to itself (public), so the guard lets it through.
  const result = await deliverWebhook("http://1.2.3.4/hook", payload);
  expect(result.ok).toBe(true);
});

test("an unresolvable hostname is refused", async () => {
  let called = false;
  globalThis.fetch = mock(async () => {
    called = true;
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const result = await deliverWebhook("http://does-not-exist.example.org/hook", payload);
  expect(result.ok).toBe(false);
  expect(called).toBe(false);
});

test("isPrivateIp classifies loopback, private, link-local and ULA", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    expect(isPrivateIp(ip)).toBe(true);
  }
  for (const ip of ["1.2.3.4", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) {
    expect(isPrivateIp(ip)).toBe(false);
  }
});

test("isPrivateIp covers the whole fe80::/10 and hex IPv4-mapped ranges", () => {
  // The link-local block is fe80-febf, not just fe80:.
  for (const ip of ["fe80::1", "fe90::1", "fea0::1", "febf::1"]) {
    expect(isPrivateIp(ip)).toBe(true);
  }
  // Public IPv6 outside those ranges must not be flagged.
  expect(isPrivateIp("fe00::1")).toBe(false);
  expect(isPrivateIp("fec0::1")).toBe(false);
  // IPv4-mapped IPv6 can also be written in hex form (::ffff:7f00:1 == 127.0.0.1).
  expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
  expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
  expect(isPrivateIp("::ffff:1.2.3.4")).toBe(false);
});

// The create/patch routes must refuse a resolving-private URL at the boundary,
// not only at delivery time.
async function adminReq(body: unknown): Promise<NextRequest> {
  const { hash, salt } = hashPassword("password123");
  const settings = await db.settings.create({
    data: { id: "main", passwordHash: hash, passwordSalt: salt },
  });
  const session = await db.session.create({
    data: { token: "sess", expiresAt: new Date(Date.now() + 60_000) },
  });
  const unlock = issueUnlockToken(settings.passwordHash);
  return new NextRequest("http://localhost/api/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${session.token}; ${UNLOCK_COOKIE}=${unlock.token}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

test("creating a channel that resolves to loopback is rejected with 400", async () => {
  const { POST } = await import("@/app/api/webhooks/route");
  const res = await POST(await adminReq({ name: "evil", url: "http://evil.example.com/hook" }));
  expect(res.status).toBe(400);
  expect(await db.webhookChannel.count()).toBe(0);
});

test("creating a channel on a public host succeeds", async () => {
  const { POST } = await import("@/app/api/webhooks/route");
  const res = await POST(await adminReq({ name: "ok", url: "https://hooks.slack.com/services/x" }));
  expect(res.status).toBe(201);
  expect(await db.webhookChannel.count()).toBe(1);
});
