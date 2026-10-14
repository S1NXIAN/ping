// Export then import is the documented backup/restore path ("Export monitors
// (JSON)"). A restore must return the dashboard to the layout the operator had:
// the pin state and the manual order are part of that configuration, so they
// must survive the round trip. Files written before these fields existed must
// still import, with the same defaults a fresh monitor gets.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
});

/** A request carrying a valid session cookie. */
async function authed(path: string, init?: { method?: string; body?: string }): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=sess` },
  });
}

/** The JSON body of GET /api/export. */
async function exportPayload(): Promise<{
  monitors: { name: string; pinned?: boolean; position?: number }[];
}> {
  const { GET } = await import("@/app/api/export/route");
  const res = await GET(await authed("/api/export"));
  return res.json();
}

test("the export carries each monitor's pin state and manual position", async () => {
  await db.monitor.create({ data: { name: "a", url: "https://a.com", pinned: true, position: 3 } });
  await db.monitor.create({ data: { name: "b", url: "https://b.com", pinned: false, position: 7 } });

  const { monitors } = await exportPayload();
  const a = monitors.find((m) => m.name === "a")!;
  const b = monitors.find((m) => m.name === "b")!;
  expect(a.pinned).toBe(true);
  expect(a.position).toBe(3);
  expect(b.pinned).toBe(false);
  expect(b.position).toBe(7);
});

test("import restores the pin state and order the export recorded", async () => {
  await db.monitor.create({ data: { name: "a", url: "https://a.com", pinned: true, position: 3 } });
  await db.monitor.create({ data: { name: "b", url: "https://b.com", pinned: false, position: 7 } });
  const payload = await exportPayload();

  // Simulate restoring into a fresh install: wipe monitors, then import.
  await db.check.deleteMany();
  await db.monitor.deleteMany();
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await authed("/api/import", { method: "POST", body: JSON.stringify(payload) }),
  );
  expect(res.status).toBe(200);

  const restored = await db.monitor.findMany({ orderBy: { name: "asc" } });
  const a = restored.find((m) => m.name === "a")!;
  const b = restored.find((m) => m.name === "b")!;
  expect(a.pinned).toBe(true);
  expect(b.pinned).toBe(false);
  // The manual order is the export's, not the import's append order.
  expect(a.position).toBe(3);
  expect(b.position).toBe(7);
});

test("a file without pinned/position still imports, with safe defaults", async () => {
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await authed("/api/import", {
      method: "POST",
      body: JSON.stringify({
        app: "PING",
        version: 1,
        monitors: [{ name: "legacy", url: "https://legacy.com" }],
      }),
    }),
  );
  expect(res.status).toBe(200);
  const m = await db.monitor.findFirstOrThrow({ where: { name: "legacy" } });
  expect(m.pinned).toBe(false);
  // Appended at the end (position 0 in an empty fleet), never a fixed 0 that
  // would collide with an existing monitor.
  expect(m.position).toBe(0);
});
