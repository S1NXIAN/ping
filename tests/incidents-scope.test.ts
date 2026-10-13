// GET /api/incidents is scoped to the active Folder (?folderId=), so the
// dashboard's badge and sheet show only the Scope's incidents. Scoping MUST
// happen before the MAX_INCIDENTS cap is applied: filtering the capped list
// client-side would silently drop a folder's 16th+ incident and undercount
// the badge. Expected values come from real seeded checks.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
});

async function get(folderId?: string): Promise<NextRequest> {
  await db.session.create({ data: { token: "sess" } });
  const url = folderId
    ? `http://localhost/api/incidents?folderId=${encodeURIComponent(folderId)}`
    : "http://localhost/api/incidents";
  return new NextRequest(url, { headers: { cookie: `${SESSION_COOKIE}=sess` } });
}

/** One ongoing incident (a single newest down check, nothing after it). */
async function seedDownMonitor(name: string, folderId: string | null) {
  const m = await db.monitor.create({
    data: { name, url: `https://${name}.example.com`, intervalSec: 60, folderId },
  });
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date() },
  });
  return m;
}

test("without folderId the list covers the whole Fleet", async () => {
  const folder = await db.folder.create({ data: { name: "Render Free" } });
  await seedDownMonitor("filed", folder.id);
  await seedDownMonitor("unfiled", null);

  const { GET } = await import("@/app/api/incidents/route");
  const res = await GET(await get());
  const { incidents } = await res.json();
  expect(incidents.map((i: { monitorName: string }) => i.monitorName).sort()).toEqual([
    "filed",
    "unfiled",
  ]);
});

test("folderId narrows the list to that Folder's monitors only", async () => {
  const folder = await db.folder.create({ data: { name: "Render Free" } });
  await seedDownMonitor("filed", folder.id);
  await seedDownMonitor("unfiled", null);

  const { GET } = await import("@/app/api/incidents/route");
  const res = await GET(await get(folder.id));
  const { incidents } = await res.json();
  expect(incidents.map((i: { monitorName: string }) => i.monitorName)).toEqual(["filed"]);
});

test("an empty Folder yields no incidents", async () => {
  const folder = await db.folder.create({ data: { name: "Empty" } });
  await seedDownMonitor("elsewhere", null);

  const { GET } = await import("@/app/api/incidents/route");
  const res = await GET(await get(folder.id));
  const { incidents } = await res.json();
  expect(incidents).toEqual([]);
});

test("a rival Folder's incidents never consume this Folder's cap", async () => {
  const { MAX_INCIDENTS } = await import("@/lib/incidents");
  const a = await db.folder.create({ data: { name: "A" } });
  const b = await db.folder.create({ data: { name: "B" } });

  // B holds more than the global cap and is NEWER; A holds 5, older. Unscoped,
  // the cap fills with B's and a client-side filter would return ZERO of A's.
  // Scoping before the cap is exactly what keeps all 5 of A's.
  async function seedClosed(name: string, folderId: string, n: number, ageHours: number) {
    const m = await db.monitor.create({
      data: { name, url: `https://${name}.example.com`, intervalSec: 60, folderId },
    });
    const now = Date.now();
    const rows: { monitorId: string; status: string; statusCode: number; checkedAt: Date }[] = [];
    for (let i = 0; i < n; i++) {
      const base = now - (ageHours + n - i) * 3_600_000;
      rows.push({ monitorId: m.id, status: "down", statusCode: 500, checkedAt: new Date(base) });
      rows.push({ monitorId: m.id, status: "up", statusCode: 200, checkedAt: new Date(base + 60_000) });
    }
    await db.check.createMany({ data: rows });
  }
  await seedClosed("in-b", b.id, MAX_INCIDENTS + 5, 0); // newer
  await seedClosed("in-a", a.id, 5, 100); // older

  const { GET } = await import("@/app/api/incidents/route");
  const res = await GET(await get(a.id));
  const { incidents } = await res.json();
  expect(incidents).toHaveLength(5);
  expect(incidents.every((i: { monitorName: string }) => i.monitorName === "in-a")).toBe(true);
});
