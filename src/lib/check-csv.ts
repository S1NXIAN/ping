// CSV export of a monitor's recorded checks. Reads the history in pages and
// yields one row at a time, so the route can stream it without ever holding the
// whole table in memory — under "keep forever" a 1-minute monitor holds
// hundreds of thousands of rows. Extracted from the route so the paging and the
// cell escaping are testable on their own.
import { db } from "./db";

export const CHECK_CSV_HEADER = "checkedAt,status,statusCode,responseMs,error";

/** Rows per page. Bounded memory; a page is one indexed seek + LIMIT. */
export const CSV_PAGE_SIZE = 1000;

interface CsvCheck {
  checkedAt: Date;
  status: string;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
}

/**
 * Escapes one CSV cell. A spreadsheet runs a cell that STARTS with = + - @ (or
 * a tab/CR) as a formula — the error cell carries the monitored host's own
 * reason phrase — so such a cell is prefixed with ' to keep it inert. Cells
 * with a comma, quote or newline are quoted, quotes doubled.
 */
export function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One check as a CSV line, in the header's column order. */
export function checkToCsvRow(c: CsvCheck): string {
  return [
    c.checkedAt.toISOString(),
    c.status,
    csvCell(c.statusCode),
    csvCell(c.responseMs),
    csvCell(c.error),
  ].join(",");
}

/**
 * Yields a monitor's checks oldest-first, one page at a time. Keyset paging on
 * (checkedAt, id) so a page is a bounded index seek and rows written during the
 * export cannot shift the window (an OFFSET would re-serve or skip rows).
 */
export async function* pagedChecks(
  monitorId: string,
  pageSize = CSV_PAGE_SIZE,
): AsyncGenerator<CsvCheck> {
  let after: { checkedAt: Date; id: string } | null = null;
  for (;;) {
    const page = await db.check.findMany({
      where: {
        monitorId,
        ...(after
          ? {
              OR: [
                { checkedAt: { gt: after.checkedAt } },
                { checkedAt: after.checkedAt, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ checkedAt: "asc" }, { id: "asc" }],
      take: pageSize,
      select: {
        id: true,
        checkedAt: true,
        status: true,
        statusCode: true,
        responseMs: true,
        error: true,
      },
    });
    if (page.length === 0) return;
    for (const row of page) yield row;
    if (page.length < pageSize) return;
    const last = page[page.length - 1];
    after = { checkedAt: last.checkedAt, id: last.id };
  }
}
