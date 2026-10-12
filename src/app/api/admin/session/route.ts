import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard, SESSION_DEFAULT_MINUTES, SESSION_PRESETS } from "@/lib/ping-auth";
import type { SessionSettingsResponse } from "@/lib/ping-types";

async function responseBody(): Promise<SessionSettingsResponse> {
  const s = await db.settings.findUnique({
    where: { id: "main" },
    select: { sessionMinutes: true },
  });
  return {
    sessionMinutes: s?.sessionMinutes ?? SESSION_DEFAULT_MINUTES,
    presets: [...SESSION_PRESETS],
    defaultMinutes: SESSION_DEFAULT_MINUTES,
  };
}

/** Current session-length setting. */
export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await responseBody(), {
    headers: { "Cache-Control": "no-store" },
  });
}

const schema = z.object({
  // Only the offered presets are accepted — a mistyped 0 can never lock the
  // operator out of a zero-length session. Derived from SESSION_PRESETS so
  // adding a preset needs no edit here.
  sessionMinutes: z
    .number()
    .int()
    .refine((n) => (SESSION_PRESETS as readonly number[]).includes(n), {
      message: "Pick one of the offered durations",
    }),
});

/** Sets the absolute session length. Applies to sessions created after this. */
export async function POST(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick one of the offered durations" }, { status: 400 });
  }

  await db.settings.update({
    where: { id: "main" },
    data: { sessionMinutes: parsed.data.sessionMinutes },
  });
  return NextResponse.json(await responseBody());
}
