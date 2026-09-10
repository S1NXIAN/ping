import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueChecks, runDueScheduledPings, runtimeState } from "@/lib/checker";

/**
 * External trigger endpoint for schedulers (GitHub Actions, cron-job.org,
 * UptimeRobot, …). Each hit runs every monitor whose interval has elapsed —
 * so pinging PING both wakes it up and performs the real checks. Due
 * scheduled pings are fired here too (their runner has its own overlap guard).
 *
 * Optionally set the CRON_SECRET env var to require ?token=<secret>.
 * A 20 s global throttle stops abuse; it never blocks the in-process
 * scheduler, which shares runDueChecks' overlap guard.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const token =
      req.nextUrl.searchParams.get("token") ?? req.headers.get("x-cron-token") ?? "";
    // Timing-safe compare — a plain !== would leak the secret's length and
    // let an attacker measure early-exit byte matches.
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 403 });
    }
  }

  const now = Date.now();
  if (now - runtimeState.lastTickAttemptAt < 20_000 && !runtimeState.running) {
    return NextResponse.json({
      ok: true,
      throttled: true,
      ran: 0,
      up: runtimeState.lastTick?.up ?? 0,
      down: runtimeState.lastTick?.down ?? 0,
      lastTickAt: runtimeState.lastTickAt,
      serverTime: new Date().toISOString(),
    });
  }
  runtimeState.lastTickAttemptAt = now;

  const result = await runDueChecks();
  const pings = await runDueScheduledPings();
  return NextResponse.json({
    ok: true,
    throttled: false,
    ran: result.ran,
    up: result.up,
    down: result.down,
    scheduledPingsRan: pings.ran,
    durationMs: result.durationMs,
    serverTime: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
