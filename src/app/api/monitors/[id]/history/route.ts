import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { CHECK_CSV_HEADER, checkToCsvRow, pagedChecks } from "@/lib/check-csv";
import type { HistoryPoint, HistoryRange, MonitorHistoryResponse } from "@/lib/ping-types";

type Params = { params: Promise<{ id: string }> };

const RANGE_MS: Record<HistoryRange, number> = {
  "1h": 3600_000,
  "24h": 86400_000,
  "7d": 7 * 86400_000,
};

/** Max points sent to the chart — denser windows get bucket-averaged. */
const MAX_POINTS = 400;

function parseRange(v: string | null): HistoryRange {
  return v === "1h" || v === "24h" || v === "7d" ? v : "24h";
}

/** The CSV export body, streamed row by row (see check-csv.ts). */
function csvStream(monitorId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const rows = pagedChecks(monitorId);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(CHECK_CSV_HEADER + "\n"));
    },
    async pull(controller) {
      const { value, done } = await rows.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(checkToCsvRow(value) + "\n"));
    },
    async cancel() {
      await rows.return?.(undefined);
    },
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const monitor = await db.monitor.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!monitor) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }

  // CSV export: full retained history, streamed one page at a time so a
  // keep-forever monitor never loads its whole table into memory.
  const sp = req.nextUrl.searchParams;
  if (sp.get("format") === "csv") {
    const safeName = monitor.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "monitor";
    return new NextResponse(csvStream(id), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ping-${safeName}-checks.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const range = parseRange(sp.get("range"));
  const now = Date.now();
  const fromMs = now - RANGE_MS[range];
  const checks = await db.check.findMany({
    where: { monitorId: id, checkedAt: { gte: new Date(fromMs) } },
    orderBy: { checkedAt: "asc" },
    select: { checkedAt: true, status: true, responseMs: true },
  });

  let points: HistoryPoint[] = [];
  let downsampled = false;

  if (checks.length <= MAX_POINTS) {
    points = checks.map((c) => ({
      t: c.checkedAt.getTime(),
      ms: c.status === "up" ? c.responseMs : null,
      // narrow the stored string to the literal union the chart expects
      s: c.status === "up" ? ("up" as const) : ("down" as const),
    }));
  } else {
    // Bucket-average: window / MAX_POINTS buckets, each with avg(up ms) and
    // "down" when any check in the bucket failed. Empty buckets are skipped —
    // the chart draws gaps, never fabricated points.
    downsampled = true;
    const bucketMs = Math.ceil(RANGE_MS[range] / MAX_POINTS);
    let i = 0;
    while (i < checks.length) {
      const bucketStart = checks[i].checkedAt.getTime();
      const bucketEnd = bucketStart + bucketMs;
      let sum = 0;
      let upCount = 0;
      let anyDown = false;
      while (i < checks.length && checks[i].checkedAt.getTime() < bucketEnd) {
        const c = checks[i];
        if (c.status === "up") {
          if (c.responseMs != null) {
            sum += c.responseMs;
            upCount++;
          }
        } else {
          anyDown = true;
        }
        i++;
      }
      points.push({
        t: bucketStart,
        ms: upCount > 0 ? Math.round(sum / upCount) : null,
        s: anyDown ? "down" : "up",
      });
    }
  }

  const body: MonitorHistoryResponse = {
    range,
    from: new Date(fromMs).toISOString(),
    to: new Date(now).toISOString(),
    points,
    checks: checks.length,
    downsampled,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
