// The CSV export writes one row per recorded check. The `error` cell carries
// server-influenced text: for a non-2xx response the checker stores
// `HTTP <status> <statusText>`, and statusText is the monitored host's own
// reason phrase. A spreadsheet runs a cell that STARTS with = + - @ (or a tab)
// as a formula, so the export must neutralise such a cell at the boundary
// (CODING_STANDARD §5) rather than rely on the current "HTTP <code> " prefix
// happening to sit in front of it. A restored or hand-edited database can hold
// any error string, and a future change to the error format must not silently
// turn the export into a delivery vector.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
});

/** The CSV body of a monitor's history export. */
async function exportCsv(monitorId: string): Promise<string> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  const { GET } = await import("@/app/api/monitors/[id]/history/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/monitors/${monitorId}/history?format=csv`, {
      headers: { cookie: `${SESSION_COOKIE}=sess` },
    }),
    { params: Promise.resolve({ id: monitorId }) },
  );
  return res.text();
}

/** The last cell of every data row, with one layer of CSV quoting removed. */
function errorCells(csv: string): string[] {
  return csv
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const raw = line.replace(/^.*?,([^,]*)$/, "$1");
      return raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1).replaceAll('""', '"')
        : raw;
    });
}

/** True when a spreadsheet would read the cell as a formula. */
function isFormula(cell: string): boolean {
  return /^[=+\-@\t\r]/.test(cell);
}

test("a stored error that begins with a formula trigger is neutralised", async () => {
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  await db.check.create({
    data: {
      monitorId: m.id,
      status: "down",
      statusCode: 500,
      error: "=cmd|' /C calc'!A0",
      checkedAt: new Date(),
    },
  });

  const [cell] = errorCells(await exportCsv(m.id));
  expect(isFormula(cell)).toBe(false);
  // The text is preserved (inert), not dropped.
  expect(cell).toContain("cmd|' /C calc'!A0");
});

test("a leading + - @ or tab in a stored error is neutralised too", async () => {
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  for (const [i, err] of ["+1+1", "-2+3", "@SUM(A1)", "\t=cmd"].entries()) {
    await db.check.create({
      data: { monitorId: m.id, status: "down", statusCode: 500, error: err, checkedAt: new Date(i * 1000) },
    });
  }
  const cells = errorCells(await exportCsv(m.id));
  expect(cells).toHaveLength(4);
  for (const cell of cells) {
    expect(isFormula(cell)).toBe(false);
  }
});

test("a normal error message is exported unchanged", async () => {
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  await db.check.create({
    data: {
      monitorId: m.id,
      status: "down",
      statusCode: 503,
      error: "HTTP 503 Service Unavailable",
      checkedAt: new Date(),
    },
  });
  expect(await exportCsv(m.id)).toContain("HTTP 503 Service Unavailable");
});
