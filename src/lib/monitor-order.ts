// Monitor ordering against the database: the next free manual-order position
// for a new monitor. Lives apart from lib/reorder.ts (the pure, client-shared
// reorder math) so this one can touch Prisma without dragging it into the
// browser bundle.
import { db } from "./db";

/** Next free manual-order position for a new monitor (appends at the end).
 *  Accepts a transaction client so an import can compute it inside its tx. */
export async function nextMonitorPosition(
  client: Pick<typeof db, "monitor"> = db,
): Promise<number> {
  const agg = await client.monitor.aggregate({ _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}
