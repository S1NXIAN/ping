import { NextResponse } from "next/server";

/**
 * Public, dependency-free health endpoint. Designed for external
 * keep-alive pingers (cron-job.org, UptimeRobot, GitHub Actions, …):
 * cheap, never touches the DB, and counts as inbound traffic so idle
 * services stay awake on hosts like Render's free tier.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, app: "PING", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
