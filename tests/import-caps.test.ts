// Import restores monitors, folders, channels and windows from a PING export.
// The create route enforces MAX_MONITORS and the maintenance-window caps; the
// import route must enforce the same limits against the CURRENT totals, not
// only against the size of the incoming file.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { hashPassword, issueUnlockToken, SESSION_COOKIE, UNLOCK_COOKIE } from "@/lib/ping-auth";
import { MAX_MONITORS } from "@/lib/checker";

async function importReq(body: unknown): Promise<NextRequest> {
  const { hash, salt } = hashPassword("password123");
  const settings = await db.settings.create({
    data: { id: "main", passwordHash: hash, passwordSalt: salt },
  });
  const session = await db.session.create({
    data: { token: "sess", expiresAt: new Date(Date.now() + 60_000) },
  });
  const unlock = issueUnlockToken(settings.passwordHash);
  return new NextRequest("http://localhost/api/import", {
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

test("importing maintenance windows past the total cap is refused", async () => {
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  const start = Date.now() + 60_000;
  await db.maintenanceWindow.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      monitorId: m.id,
      startsAt: new Date(start + i * 3_600_000),
      endsAt: new Date(start + i * 3_600_000 + 1_800_000),
    })),
  });
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [],
      maintenanceWindows: [
        {
          monitor: "svc",
          startsAt: new Date(start + 100 * 3_600_000).toISOString(),
          endsAt: new Date(start + 100 * 3_600_000 + 1_800_000).toISOString(),
        },
      ],
    }),
  );
  expect(res.status).toBe(400);
  expect(await db.maintenanceWindow.count()).toBe(50);
});

test("a rejected import writes nothing at all (no partial import)", async () => {
  // A file that passes the monitor cap but blows the window cap, and carries a
  // new folder + a new monitor: the 400 must leave the DB exactly as it was.
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  const start = Date.now() + 60_000;
  await db.maintenanceWindow.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      monitorId: m.id,
      startsAt: new Date(start + i * 3_600_000),
      endsAt: new Date(start + i * 3_600_000 + 1_800_000),
    })),
  });
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      folders: [{ name: "brand-new" }],
      monitors: [{ name: "added", url: "https://added.example.com", folder: "brand-new" }],
      maintenanceWindows: [
        {
          monitor: "svc",
          startsAt: new Date(start + 100 * 3_600_000).toISOString(),
          endsAt: new Date(start + 100 * 3_600_000 + 1_800_000).toISOString(),
        },
      ],
    }),
  );
  expect(res.status).toBe(400);
  expect(await db.monitor.count()).toBe(1); // only the pre-existing one
  expect(await db.folder.count()).toBe(0);
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

test("importing a channel that resolves to loopback is refused", async () => {
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [],
      webhookChannels: [{ name: "evil", url: "http://evil.example.com/hook" }],
    }),
  );
  expect(res.status).toBe(400);
  expect(await db.webhookChannel.count()).toBe(0);
});

test("importing a public channel succeeds", async () => {
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [],
      webhookChannels: [{ name: "ok", url: "https://hooks.slack.com/services/x" }],
    }),
  );
  expect(res.status).toBe(200);
  expect(await db.webhookChannel.count()).toBe(1);
});

test("importing a non-http channel scheme is refused", async () => {
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq({
      app: "PING",
      version: 1,
      monitors: [],
      webhookChannels: [{ name: "ftp", url: "ftp://example.com/hook" }],
    }),
  );
  expect(res.status).toBe(400);
  expect(await db.webhookChannel.count()).toBe(0);
});
