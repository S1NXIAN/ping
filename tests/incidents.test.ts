// deriveIncidents stitches real down checks into incidents. Expected values
// come from worked examples, not the implementation.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

beforeEach(async () => {
  await resetDb();
});

test("a run of down checks becomes one incident, closed by the next up", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  const t = (min: number) => new Date(Date.now() - min * 60_000);
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", checkedAt: t(10) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(9) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(8) },
      { monitorId: m.id, status: "up", checkedAt: t(7) },
    ],
  });

  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(1);
  expect(incidents[0].downChecks).toBe(2);
  expect(incidents[0].lastStatusCode).toBe(503);
  expect(incidents[0].endedAt).not.toBeNull();
});

test("an up check in the middle splits two incidents", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  const t = (min: number) => new Date(Date.now() - min * 60_000);
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 500, checkedAt: t(9) },
      { monitorId: m.id, status: "up", checkedAt: t(8) },
      { monitorId: m.id, status: "down", statusCode: 502, checkedAt: t(7) },
    ],
  });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(2);
});

test("an ongoing down run has endedAt null", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date() },
  });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(1);
  expect(incidents[0].endedAt).toBeNull();
});

test("a down fully inside a maintenance window is not an incident", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  const start = new Date(Date.now() - 9 * 60_000);
  const end = new Date(Date.now() - 7 * 60_000);
  await db.maintenanceWindow.create({
    data: { monitorId: m.id, startsAt: new Date(start.getTime() - 60_000), endsAt: new Date(end.getTime() + 60_000) },
  });
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: start },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: end },
    ],
  });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(0);
});
