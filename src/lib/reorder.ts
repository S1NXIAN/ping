// Reorder math, pure and framework-free so it is testable without a DOM.
// Two callers share it: the drag session in `use-card-reorder` and the card
// menu's Move up/down in the dashboard.

/** Move `list[from]` to index `to`, returning a new array.
 *  `to` is read in the array's post-removal indexing (splice order). */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Step `id` one slot through the VISIBLE `visibleIds`, applied to the full
 * `items`. A filtered view (folder or search) therefore moves a card past the
 * neighbour the operator can actually see, and monitors hidden by the filter
 * keep their relative order. Returns null when the step is a no-op — `id`
 * missing, or already at the end it is moving toward.
 */
export function moveByStep<T extends { id: string }>(
  items: readonly T[],
  visibleIds: readonly string[],
  id: string,
  dir: -1 | 1,
): T[] | null {
  const i = visibleIds.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= visibleIds.length) return null;

  const from = items.findIndex((m) => m.id === id);
  if (from < 0) return null;

  // The anchor is where `id` must land relative to: after it when moving down,
  // before it when moving up. Its index is read without `id` present, which is
  // the indexing `reorder` splices into.
  const anchorId = visibleIds[j];
  const to = items.filter((m) => m.id !== id).findIndex((m) => m.id === anchorId);
  if (to < 0) return null;

  return reorder(items, from, dir === 1 ? to + 1 : to);
}

/**
 * The pin set after moving `movedId` inside `list`: the pinned zone is the
 * block of OTHER pinned monitors at the top, so dropping strictly inside it
 * pins the card and landing at or below the boundary (the first unpinned slot)
 * unpins it.
 */
export function pinnedSetAfterMove(
  list: readonly { id: string; pinned: boolean }[],
  movedId: string,
): Set<string> {
  const pinned = new Set(list.filter((m) => m.pinned).map((m) => m.id));
  const idx = list.findIndex((m) => m.id === movedId);
  if (idx >= 0) {
    const otherPinned = list.filter((m) => m.id !== movedId && m.pinned).length;
    if (idx < otherPinned) pinned.add(movedId);
    else pinned.delete(movedId);
  }
  return pinned;
}
