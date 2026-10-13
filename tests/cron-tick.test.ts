// /api/cron/tick gates on CRON_SECRET when it is set. A stranger who finds the
// tick URL can otherwise make PING fetch every monitor — including the
// localhost/LAN targets the trust model allows — so the failure direction
// matters: a wrong or missing token must be refused, the real one must run.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { resetDb } from "./helpers/test-db";
import { runtimeState } from "@/lib/checker";

const SECRET = "test-cron-secret";

beforeEach(async () => {
  await resetDb();
  process.env.CRON_SECRET = SECRET;
  runtimeState.lastTickAttemptAt = 0; // don't let the 20 s throttle mask a run
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

function tick(headers: Record<string, string> = {}): Promise<Response> {
  return import("@/app/api/cron/tick/route").then(({ GET }) =>
    GET(new NextRequest("http://localhost/api/cron/tick", { headers })),
  );
}

test("a tick with no token is refused while the secret is set", async () => {
  expect((await tick()).status).toBe(403);
});

test("a tick with the wrong token is refused", async () => {
  expect((await tick({ "x-cron-token": "not-the-secret" })).status).toBe(403);
});

test("a tick with the token in the x-cron-token header succeeds", async () => {
  const res = await tick({ "x-cron-token": SECRET });
  expect(res.status).toBe(200);
  // throttled:false distinguishes a real run from the 20 s throttle, which
  // also returns 200/ok:true and would make the status assertion meaningless.
  expect((await res.json()).throttled).toBe(false);
});

test("a tick with the token as ?token= succeeds", async () => {
  const { GET } = await import("@/app/api/cron/tick/route");
  const res = await GET(new NextRequest(`http://localhost/api/cron/tick?token=${SECRET}`));
  expect(res.status).toBe(200);
});

test("with no secret set the tick runs unauthenticated", async () => {
  delete process.env.CRON_SECRET;
  runtimeState.lastTickAttemptAt = 0;
  expect((await tick()).status).toBe(200);
});
