// Import restores monitors and folders from a PING export. The create route
// enforces MAX_MONITORS; the import route must enforce the same limit against
// the CURRENT total, not only against the size of the incoming file.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { hashPassword, SESSION_COOKIE } from "@/lib/ping-auth";
import { MAX_MONITORS } from "@/lib/checker";

async function importReq(body: unknown): Promise<NextRequest> {
  const { hash, salt } = hashPassword("password123");
  await db.settings.create({
    data: { id: "main", passwordHash: hash, passwordSalt: salt },
  });
  const session = await db.session.create({
    data: { token: "sess" },
  });
  return new NextRequest("http://localhost/api/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${session.token}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

test("importing past the monitor cap is refused", async () => {
  await db.monitor.createMany({
    data: Array.from({ length: MAX_MONITORS }, (_, i) => ({
      name: `m${i}`,
      url: `https://existing-${i}.example.com`,
    })),
  });
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [{ name: "new", url: "https://new.example.com" }],
    }),
  );
  expect(res.status).toBe(400);
  expect(await db.monitor.count()).toBe(MAX_MONITORS);
});

test("importing monitors up to the cap succeeds", async () => {
  await db.monitor.createMany({
    data: Array.from({ length: MAX_MONITORS - 1 }, (_, i) => ({
      name: `m${i}`,
      url: `https://existing-${i}.example.com`,
    })),
  });
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [{ name: "last", url: "https://last.example.com" }],
    }),
  );
  expect(res.status).toBe(200);
  expect(await db.monitor.count()).toBe(MAX_MONITORS);
});

test("a file whose monitors already exist is skipped, not counted against the cap", async () => {
  await db.monitor.create({ data: { name: "dup", url: "https://dup.example.com" } });
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [{ name: "dup", url: "https://dup.example.com" }],
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.created).toBe(0);
  expect(body.skipped).toBe(1);
});

test("an old-format export carrying removed fields still imports", async () => {
  // A file written before scheduled pings / maintenance / webhooks were
  // removed: the unknown fields are simply ignored, monitors still land.
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [{ name: "legacy", url: "https://legacy.example.com" }],
      scheduledPings: [{ monitorId: "x", runAt: new Date().toISOString() }],
      maintenanceWindows: [{ monitor: "legacy", startsAt: new Date().toISOString(), endsAt: new Date().toISOString() }],
      webhookChannels: [{ name: "old", url: "https://hooks.slack.com/services/x" }],
    }),
  );
  expect(res.status).toBe(200);
  expect(await db.monitor.count()).toBe(1);
});

test("a bad schedule in one monitor rejects the whole file before writing", async () => {
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      folders: [{ name: "f" }],
      monitors: [
        { name: "good", url: "https://good.example.com" },
        { name: "bad", url: "https://bad.example.com", scheduleMode: "times", timezone: "Asia/Manila" },
      ],
    }),
  );
  expect(res.status).toBe(400);
  expect(await db.monitor.count()).toBe(0);
  expect(await db.folder.count()).toBe(0);
});

// A hand-edited export with more clock times than the cap must be refused, not
// silently truncated: parseTimes drops the extras, so importing 13 times would
// leave the operator believing all 13 are set. The editor already prevents it.
test("importing more clock times than the cap is refused, not silently truncated", async () => {
  const { MAX_SCHEDULE_TIMES } = await import("@/lib/schedule");
  const many = Array.from({ length: MAX_SCHEDULE_TIMES + 1 }, (_, i) =>
    `${String(i).padStart(2, "0")}:00`,
  ).join(",");
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [
        {
          name: "busy",
          url: "https://busy.example.com",
          scheduleMode: "times",
          scheduleTimes: many,
          timezone: "Asia/Manila",
        },
      ],
    }),
  );
  expect(res.status).toBe(400);
  expect(await db.monitor.count()).toBe(0);
});
