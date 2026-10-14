// The write routes that change security or persisted state had no test. These
// are the invariants a refactor could silently break: changing the password
// must revoke every other session, reorder must persist the exact order and pin
// set, and retention must store the policy and actually prune.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { hashPassword, SESSION_COOKIE, verifyPassword } from "@/lib/ping-auth";

/** A request carrying a valid session cookie (the routes are all auth-guarded).
 *  Idempotent: several calls in one test share the one "sess" token. */
async function authed(path: string, body: unknown, method = "POST"): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=sess` },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

// ---- POST /api/admin/password ----

test("changing the password signs out every other session and issues a fresh one", async () => {
  const { hash, salt } = await hashPassword("oldpassword");
  await db.settings.create({ data: { id: "main", passwordHash: hash, passwordSalt: salt } });
  // Two other browsers are signed in; "sess" is the caller.
  await db.session.createMany({ data: [{ token: "other-1" }, { token: "other-2" }] });

  const { POST } = await import("@/app/api/admin/password/route");
  const res = await POST(
    await authed("/api/admin/password", {
      currentPassword: "oldpassword",
      newPassword: "brandnewpass",
    }),
  );

  expect(res.status).toBe(200);
  // Every prior session is gone, replaced by exactly one fresh token.
  const tokens = (await db.session.findMany()).map((s) => s.token);
  expect(tokens).not.toContain("sess");
  expect(tokens).not.toContain("other-1");
  expect(tokens).not.toContain("other-2");
  expect(tokens.length).toBe(1);

  // And the stored password is the new one.
  const settings = await db.settings.findUniqueOrThrow({ where: { id: "main" } });
  expect(await verifyPassword("brandnewpass", settings.passwordHash, settings.passwordSalt)).toBe(true);
  expect(await verifyPassword("oldpassword", settings.passwordHash, settings.passwordSalt)).toBe(false);
});

test("a wrong current password changes nothing", async () => {
  const { hash, salt } = await hashPassword("oldpassword");
  await db.settings.create({ data: { id: "main", passwordHash: hash, passwordSalt: salt } });

  const { POST } = await import("@/app/api/admin/password/route");
  const res = await POST(
    await authed("/api/admin/password", {
      currentPassword: "wrongpassword",
      newPassword: "brandnewpass",
    }),
  );

  expect(res.status).toBe(401);
  expect(await db.session.count()).toBe(1); // the caller's own session survives
  const settings = await db.settings.findUniqueOrThrow({ where: { id: "main" } });
  expect(await verifyPassword("oldpassword", settings.passwordHash, settings.passwordSalt)).toBe(true);
});

// ---- PATCH /api/monitors/reorder ----

test("reorder persists the exact order and pin set", async () => {
  const a = await db.monitor.create({ data: { name: "a", url: "https://a.com", position: 0 } });
  const b = await db.monitor.create({ data: { name: "b", url: "https://b.com", position: 1 } });
  const c = await db.monitor.create({ data: { name: "c", url: "https://c.com", position: 2 } });

  const { PATCH } = await import("@/app/api/monitors/reorder/route");
  const res = await PATCH(
    await authed("/api/monitors/reorder", { ids: [c.id, a.id, b.id], pinnedIds: [c.id] }, "PATCH"),
  );

  expect(res.status).toBe(200);
  const byId = new Map((await db.monitor.findMany()).map((m) => [m.id, m]));
  expect(byId.get(c.id)!.position).toBe(0);
  expect(byId.get(a.id)!.position).toBe(1);
  expect(byId.get(b.id)!.position).toBe(2);
  expect(byId.get(c.id)!.pinned).toBe(true);
  expect(byId.get(a.id)!.pinned).toBe(false);
});

test("reorder rejects a pinned id that is not in the order", async () => {
  const a = await db.monitor.create({ data: { name: "a", url: "https://a.com" } });
  const b = await db.monitor.create({ data: { name: "b", url: "https://b.com" } });

  const { PATCH } = await import("@/app/api/monitors/reorder/route");
  const res = await PATCH(
    await authed("/api/monitors/reorder", { ids: [a.id], pinnedIds: [b.id] }, "PATCH"),
  );

  expect(res.status).toBe(400);
});

// ---- POST /api/admin/retention ----

test("retention 'set' stores the policy", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });

  const { POST } = await import("@/app/api/admin/retention/route");
  const res = await POST(await authed("/api/admin/retention", { action: "set", days: 30 }));

  expect(res.status).toBe(200);
  expect((await db.settings.findUniqueOrThrow({ where: { id: "main" } })).retentionDays).toBe(30);
});

test("retention 'prune' deletes checks older than the policy", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s", retentionDays: 30 } });
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.com" } });
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", checkedAt: new Date(Date.now() - 40 * 86400_000) }, // older than 30d
      { monitorId: m.id, status: "up", checkedAt: new Date() }, // kept
    ],
  });

  const { POST } = await import("@/app/api/admin/retention/route");
  const res = await POST(await authed("/api/admin/retention", { action: "prune" }));

  expect(res.status).toBe(200);
  expect((await res.json()).deleted).toBe(1);
  expect(await db.check.count()).toBe(1); // only the recent check survives
});
