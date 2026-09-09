import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { runCheck, nextMonitorPosition } from "@/lib/checker";
import { emptyStats, toMonitorDTO } from "@/lib/ping-stats";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z
    .string()
    .trim()
    .min(4, "URL is required")
    .max(500)
    .refine((v) => {
      try {
        const u = new URL(v);
        return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
      } catch {
        return false;
      }
    }, "Enter a valid http(s) URL"),
  folderId: z.string().trim().min(1).nullish(),
  intervalSec: z.number().int().min(60).max(86400).optional(),
  method: z.enum(["GET", "HEAD"]).optional(),
  account: z
    .string()
    .trim()
    .max(60, "Account label is too long (60 chars max)")
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export async function POST(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, url, folderId, intervalSec, method, account } = parsed.data;

  if (folderId) {
    const folder = await db.folder.findUnique({ where: { id: folderId } });
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 400 });
    }
  }

  let displayName = name;
  if (!displayName) {
    try {
      displayName = new URL(url).host;
    } catch {
      displayName = url;
    }
  }

  // New monitors append at the end of the manual order.
  const position = await nextMonitorPosition();
  const monitor = await db.monitor.create({
    data: {
      name: displayName,
      url,
      folderId: folderId ?? null,
      intervalSec: intervalSec ?? 300,
      method: method ?? "GET",
      account,
      position,
    },
  });

  // First real check runs right away in the background — the UI polls
  // the overview and will show the genuine result when it lands.
  runCheck(monitor).catch((e) => console.error("[PING] first check failed:", e));

  const dto = toMonitorDTO(monitor, null, emptyStats(), []);
  return NextResponse.json(dto, { status: 201 });
}
