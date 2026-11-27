// Import restores monitors and folders from a PING export. The create route
// enforces MAX_MONITORS; the import route must enforce the same limit against
// the CURRENT total, not only against the size of the incoming file.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { hashPassword, SESSION_COOKIE } from "@/lib/ping-auth";
import { MAX_MONITORS } from "@/lib/checker";

async function importReq(body: unknown): Promise<NextRequest> {
  const { hash, salt } = await hashPassword("password123");
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

/** A current-format monitor; import requires every field. */
function monitor(overrides: Record<string, unknown> = {}) {
  return {
    name: "m",
    url: "https://m.example.com",
    method: "GET",
    intervalSec: 300,
    enabled: true,
    keywordMode: "contains",
    pinned: false,
    position: 0,
    ...overrides,
  };
}

function payload(monitors: unknown[]) {
  return { app: "PING", version: 1, monitors, folders: [] };
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
    await importReq(payload([monitor({ name: "new", url: "https://new.example.com" })])),
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
    await importReq(payload([monitor({ name: "last", url: "https://last.example.com" })])),
  );
  expect(res.status).toBe(200);
  expect(await db.monitor.count()).toBe(MAX_MONITORS);
});

test("a file whose monitors already exist is skipped, not counted against the cap", async () => {
  await db.monitor.create({ data: { name: "dup", url: "https://dup.example.com" } });
  const { POST } = await import("@/app/api/import/route");
  const res = await POST(
    await importReq(payload([monitor({ name: "dup", url: "https://dup.example.com" })])),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.created).toBe(0);
  expect(body.skipped).toBe(1);
});
