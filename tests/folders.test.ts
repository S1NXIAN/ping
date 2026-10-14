// Folder management: create, rename, delete. Names must be unique, deletion
// must return the folder's monitors to the top level (never delete them), and
// every route is auth-guarded. Expected values come from worked examples.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
});

async function authed(path: string, method: string, body?: unknown): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=sess` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createFolder(name: string): Promise<Response> {
  const { POST } = await import("@/app/api/folders/route");
  return POST(await authed("/api/folders", "POST", { name }));
}

async function renameFolder(id: string, name: string): Promise<Response> {
  const { PATCH } = await import("@/app/api/folders/[id]/route");
  return PATCH(await authed(`/api/folders/${id}`, "PATCH", { name }), {
    params: Promise.resolve({ id }),
  });
}

async function deleteFolder(id: string): Promise<Response> {
  const { DELETE } = await import("@/app/api/folders/[id]/route");
  return DELETE(await authed(`/api/folders/${id}`, "DELETE"), {
    params: Promise.resolve({ id }),
  });
}

test("creating a folder returns it", async () => {
  const res = await createFolder("Render Free");
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.name).toBe("Render Free");
  expect(await db.folder.count()).toBe(1);
});

test("a duplicate folder name is refused", async () => {
  await createFolder("Render Free");
  const res = await createFolder("Render Free");
  expect(res.status).toBe(400);
  expect(await db.folder.count()).toBe(1);
});

test("an unauthenticated create is refused", async () => {
  const { POST } = await import("@/app/api/folders/route");
  const res = await POST(
    new NextRequest("http://localhost/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    }),
  );
  expect(res.status).toBe(401);
});

test("renaming a folder keeps its monitors", async () => {
  const f = await db.folder.create({ data: { name: "Old" } });
  await db.monitor.create({ data: { name: "m", url: "https://m.com", folderId: f.id } });

  expect((await renameFolder(f.id, "New")).status).toBe(200);
  const stored = await db.folder.findUniqueOrThrow({ where: { id: f.id } });
  expect(stored.name).toBe("New");
  expect(await db.monitor.count({ where: { folderId: f.id } })).toBe(1);
});

test("renaming onto another folder's name is refused", async () => {
  await db.folder.create({ data: { name: "A" } });
  const b = await db.folder.create({ data: { name: "B" } });
  expect((await renameFolder(b.id, "A")).status).toBe(400);
});

test("renaming a missing folder is a 404", async () => {
  expect((await renameFolder("nope", "X")).status).toBe(404);
});

test("deleting a folder returns its monitors to the top level", async () => {
  const f = await db.folder.create({ data: { name: "Gone" } });
  const m = await db.monitor.create({ data: { name: "m", url: "https://m.com", folderId: f.id } });

  expect((await deleteFolder(f.id)).status).toBe(200);
  expect(await db.folder.count()).toBe(0);
  // The monitor survives, unfiled — the glossary's rule.
  const kept = await db.monitor.findUniqueOrThrow({ where: { id: m.id } });
  expect(kept.folderId).toBeNull();
});

test("deleting a missing folder is a 404", async () => {
  expect((await deleteFolder("nope")).status).toBe(404);
});
