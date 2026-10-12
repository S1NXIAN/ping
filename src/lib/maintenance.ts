// Maintenance windows — the one place the client decides whether a window is
// active, upcoming or ended, and how much time it has left.
//
// Pure and framework-free, so both client components and server routes can
// import it (see GLOSSARY.md "Maintenance window"). A window is active from
// its start instant (inclusive) to its end instant (exclusive). `checker.ts`
// keeps its own DB predicate (endsAt >= now) as the alert-suppression
// authority, so the two boundaries differ by design. The server routes in
// api/public/{status,feed} also keep their own Prisma `where` clauses — they
// filter at the database, not in JS, so they cannot call this.

/** A window's instants, ISO-8601. Both MaintenanceWindowDTO and
 *  PublicMaintenance satisfy this, so no call site converts anything. */
export interface WindowFields {
  startsAt: string;
  endsAt: string;
}

export type WindowState = "active" | "upcoming" | "ended";

/**
 * The window ladder: upcoming before it starts, active until its end instant,
 * ended from that instant on.
 */
export function windowState(w: WindowFields, now: number): WindowState {
  if (now < Date.parse(w.startsAt)) return "upcoming";
  if (now < Date.parse(w.endsAt)) return "active";
  return "ended";
}

/**
 * "1h 30m left" while active, "starts in 1h 30m" while upcoming, null once
 * ended (the caller renders nothing). Floor-based: a rounded "2h left" would
 * overstate the time, so a partial unit is always truncated.
 */
export function windowCountdown(w: WindowFields, now: number): string | null {
  const state = windowState(w, now);
  if (state === "ended") return null;
  const remainingMs =
    state === "active" ? Date.parse(w.endsAt) - now : Date.parse(w.startsAt) - now;
  const span = formatSpan(remainingMs);
  return state === "active" ? `${span} left` : `starts in ${span}`;
}

/** Floor-based, zero-skipping span: "<1m", "30m", "1h 30m", "2d 3h". */
function formatSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : "<1m";
}
