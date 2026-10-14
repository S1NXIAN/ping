// The CSV export streams a monitor's full retained history. Under the default
// policy that is capped at 1,000 rows, but "keep forever" / 365 days makes it
// hundreds of thousands — loading them all into JS (and one joined string)
// would OOM a 512 MB free instance. So the rows are read in pages and written
// to the response as they come. These tests pin the paging (every row, in
// order, across page boundaries) and the cell escaping the export depends on.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";
import { CHECK_CSV_HEADER, checkToCsvRow, pagedChecks } from "@/lib/check-csv";

beforeEach(async () => {
  await resetDb();
});

async function monitor() {
  return db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
}

test("pagedChecks yields every row, oldest first, across page boundaries", async () => {
  const m = await monitor();
  const base = Date.now();
  await db.check.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      monitorId: m.id,
      status: "up",
      responseMs: i,
      checkedAt: new Date(base + i * 1000),
    })),
  });

  const seen: number[] = [];
  for await (const row of pagedChecks(m.id, 10)) {
    seen.push(row.responseMs!);
  }

  expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i));
});

test("pagedChecks stops at the monitor's own rows", async () => {
  const a = await monitor();
  const b = await db.monitor.create({ data: { name: "other", url: "https://other.com" } });
  await db.check.createMany({
    data: [
      { monitorId: a.id, status: "up", responseMs: 1, checkedAt: new Date(1000) },
      { monitorId: b.id, status: "up", responseMs: 2, checkedAt: new Date(2000) },
      { monitorId: a.id, status: "up", responseMs: 3, checkedAt: new Date(3000) },
    ],
  });

  const seen: number[] = [];
  for await (const row of pagedChecks(a.id, 1)) seen.push(row.responseMs!);

  expect(seen).toEqual([1, 3]);
});

test("the header names the exported columns", () => {
  expect(CHECK_CSV_HEADER).toBe("checkedAt,status,statusCode,responseMs,error");
});

test("a row is written as the documented columns", () => {
  const row = checkToCsvRow({
    checkedAt: new Date("2026-01-02T03:04:05.000Z"),
    status: "down",
    statusCode: 503,
    responseMs: 120,
    error: "HTTP 503 Service Unavailable",
  });
  expect(row).toBe("2026-01-02T03:04:05.000Z,down,503,120,HTTP 503 Service Unavailable");
});

test("null cells are empty", () => {
  const row = checkToCsvRow({
    checkedAt: new Date("2026-01-02T03:04:05.000Z"),
    status: "down",
    statusCode: null,
    responseMs: null,
    error: null,
  });
  expect(row).toBe("2026-01-02T03:04:05.000Z,down,,,");
});

test("a cell that a spreadsheet would run as a formula is neutralised", () => {
  const row = checkToCsvRow({
    checkedAt: new Date("2026-01-02T03:04:05.000Z"),
    status: "down",
    statusCode: 500,
    responseMs: 1,
    error: "=cmd|' /C calc'!A0",
  });
  // The error cell is prefixed with ' so it is inert, and the text is kept.
  expect(row.endsWith(",'=cmd|' /C calc'!A0")).toBe(true);
});

test("a cell containing a comma or quote is quoted and escaped", () => {
  const row = checkToCsvRow({
    checkedAt: new Date("2026-01-02T03:04:05.000Z"),
    status: "down",
    statusCode: 500,
    responseMs: 1,
    error: 'a, b "c"',
  });
  expect(row.endsWith(',"a, b ""c"""')).toBe(true);
});
