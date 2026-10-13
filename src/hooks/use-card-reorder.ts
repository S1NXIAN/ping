"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Pointer-based drag reorder for a vertical card list.
 *
 * Why not native HTML5 drag-and-drop: it hands the browser the drag image, gives
 * no geometry during the drag (so no insertion indicator), cannot animate the
 * other cards, and does nothing on touch. Here the real card lifts and follows
 * the pointer, the siblings glide to their new slots (FLIP), and the whole
 * session is transform-only so it stays on the compositor.
 *
 * The list may be filtered (folder / search): slots are read from the cards
 * actually rendered, but each slot remembers its index in the full `items`, so
 * the splice always targets the right element of the persisted order.
 *
 * The pointer listeners attach synchronously inside `start` (not in an effect):
 * an effect runs a frame later, and a fast first move would be dropped.
 */

/** One rendered card: its viewport band, plus where it sits in `items`. */
interface Slot {
  top: number;
  height: number;
  /** Index in the full `items` array — the splice target. */
  itemIndex: number;
}

interface Options<T extends { id: string }> {
  /** The full manual-order list — stable identity (server order). */
  items: T[];
  /** The list container; every card carries `data-monitor-id`. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Persist the final order once, on drop. Resolves when the server's fresh
   *  order has landed — the preview is held until then so the list never snaps
   *  back to the stale order in the gap. */
  onCommit: (next: T[], movedId: string) => Promise<void>;
  /** Drag is available (manual sort, more than one monitor). */
  enabled: boolean;
}

export interface CardReorder<T> {
  /** The card being dragged, or null. */
  draggingId: string | null;
  /** Live reordered full list during a drag; null when idle. */
  preview: T[] | null;
  /** Y (px, relative to the list container) for the insertion indicator. */
  indicatorY: number | null;
  /** Start a drag from a card's handle. */
  start: (id: string, e: React.PointerEvent) => void;
  /** Step a card one slot up/down — the keyboard- and touch-reachable path
   *  (the grip handle is desktop-only). `order` is the visible id sequence to
   *  step through, so a filtered view moves past its visible neighbour. */
  move: (id: string, dir: -1 | 1, order: string[]) => void;
}

const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const FLIP_MS = 190;
/** A press that never travels this far is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;
/** How long a post-drag click is swallowed so it can't also open the card. */
const CLICK_GUARD_MS = 250;

export function useCardReorder<T extends { id: string }>({
  items,
  containerRef,
  onCommit,
  enabled,
}: Options<T>): CardReorder<T> {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<T[] | null>(null);
  const [indicatorY, setIndicatorY] = useState<number | null>(null);

  // Drag session lives in refs: pointer moves must never re-render on their own.
  const slots = useRef<Slot[]>([]);
  const draggedEl = useRef<HTMLElement | null>(null);
  const previewRef = useRef<T[] | null>(null);
  const pointerY = useRef(0);
  const grabOffset = useRef(0);
  const slotRef = useRef(-1);
  const startSlot = useRef(-1);
  const containerTop = useRef(0);
  const moved = useRef(false);
  /** Active pointer listeners, so a drag can be torn down from anywhere. */
  const detach = useRef<(() => void) | null>(null);
  /** Card id → viewport top, for the FLIP diff between renders. */
  const lastTops = useRef(new Map<string, number>());

  const reduceMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Pin the lifted card under the pointer. Its layout slot moves as the order
   *  changes, so the transform compensates by the same amount — the visual
   *  position stays continuous while React moves the DOM node. offsetTop is a
   *  layout value, unaffected by the transform we are about to write. */
  const applyLift = useCallback(() => {
    const el = draggedEl.current;
    if (!el) return;
    const layoutTop = containerTop.current + el.offsetTop;
    const dy = pointerY.current - grabOffset.current - layoutTop;
    el.style.transform = `translate3d(0, ${dy}px, 0) scale(1.015)`;
  }, []);

  /** The rendered-slot position under the pointer, from the band midpoints. */
  const slotAt = useCallback((y: number) => {
    const s = slots.current;
    for (let i = 0; i < s.length; i++) {
      if (y < s[i].top + s[i].height / 2) return i;
    }
    return s.length - 1;
  }, []);

  /** Step a card one slot in `order` (the visible id sequence), committing the
   *  same way a drop does. This is the touch- and keyboard-reachable path. */
  const move = useCallback(
    (id: string, dir: -1 | 1, order: string[]) => {
      if (!enabled || detach.current) return;
      const i = order.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      // Reorder the full list by moving `id` next to its new visible neighbour:
      // the item it should now sit before (up) or after (down).
      const list = items.slice();
      const from = list.findIndex((m) => m.id === id);
      if (from < 0) return;
      const [moved] = list.splice(from, 1);
      const anchorId = order[j];
      const to = list.findIndex((m) => m.id === anchorId);
      if (to < 0) return;
      list.splice(dir === 1 ? to + 1 : to, 0, moved);

      setPreview(list);
      void onCommit(list, id).finally(() => setPreview(null));
    },
    [enabled, items, onCommit],
  );

  const start = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (!enabled || detach.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const container = containerRef.current;
      const card = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-monitor-id]");
      if (!container || !card) return;

      const byId = new Map(items.map((m, i) => [m.id, i]));
      const s: Slot[] = [];
      let draggedSlot = -1;
      container.querySelectorAll<HTMLElement>("[data-monitor-id]").forEach((el) => {
        const itemIndex = byId.get(el.dataset.monitorId!);
        if (itemIndex == null) return;
        const r = el.getBoundingClientRect();
        if (el === card) draggedSlot = s.length;
        s.push({ top: r.top, height: r.height, itemIndex });
      });
      if (draggedSlot < 0) return;

      // Fresh baseline: positions may have moved since the last drag.
      lastTops.current.clear();
      slots.current = s;
      draggedEl.current = card;
      // The entrance animation (.ping-fade-up) holds its final keyframe via
      // fill-mode: both, and CSS animations outrank inline styles — clear it or
      // the lift transform below is silently ignored.
      card.style.animation = "none";
      containerTop.current = container.getBoundingClientRect().top;
      pointerY.current = e.clientY;
      grabOffset.current = e.clientY - s[draggedSlot].top;
      slotRef.current = draggedSlot;
      startSlot.current = draggedSlot;
      moved.current = false;
      previewRef.current = items;
      setDraggingId(id);
      setPreview(items);
      setIndicatorY(s[draggedSlot].top - containerTop.current);
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        pointerY.current = ev.clientY;
        const travel = ev.clientY - grabOffset.current - slots.current[startSlot.current].top;
        if (!moved.current && Math.abs(travel) > DRAG_THRESHOLD_PX) moved.current = true;
        applyLift();

        const next = slotAt(ev.clientY);
        if (next === slotRef.current) return;
        slotRef.current = next;

        // Splice the FULL list at the target's index in it, so a filtered view
        // reorders the same way an unfiltered one does.
        const list = previewRef.current ?? items;
        const from = list.findIndex((m) => m.id === id);
        const to = slots.current[next].itemIndex;
        if (from < 0 || from === to) return;
        const copy = list.slice();
        const [m] = copy.splice(from, 1);
        copy.splice(to, 0, m);
        previewRef.current = copy;
        setPreview(copy);
        setIndicatorY(slots.current[next].top - containerTop.current);
      };

      const finish = () => {
        detach.current?.();
        detach.current = null;

        const el = draggedEl.current;
        if (el) el.style.transform = "";
        document.body.style.userSelect = "";

        const dragged = moved.current;
        const list = previewRef.current;
        const changed = dragged && startSlot.current !== slotRef.current;

        // Swallow the click the browser may fire after a drag so it can't also
        // open the detail sheet. Self-clears on the click, or after a short
        // grace period if none comes — so it can never eat a later deliberate
        // click. shortcut: a real click within CLICK_GUARD_MS of a drop is
        // ignored; too fast to hit by hand, upgrade if it ever bites.
        if (dragged) {
          const guard = (ev: MouseEvent) => {
            ev.stopPropagation();
            ev.preventDefault();
            window.removeEventListener("click", guard, { capture: true });
          };
          window.addEventListener("click", guard, { capture: true });
          setTimeout(
            () => window.removeEventListener("click", guard, { capture: true }),
            CLICK_GUARD_MS,
          );
        }

        draggedEl.current = null;
        setDraggingId(null);
        setIndicatorY(null);
        if (changed && list) {
          // Hold the preview until the server confirms, so the list never
          // flashes the pre-drag order in the round-trip gap.
          void onCommit(list, id).finally(() => setPreview(null));
        } else {
          setPreview(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
    },
    [containerRef, enabled, items, onCommit, applyLift, slotAt],
  );

  // A drag outliving the component (unmount mid-drag) must not leak listeners.
  useEffect(() => () => detach.current?.(), []);

  // Re-pin the lifted card after React moves its DOM node, in the same frame —
  // the pointermove handler alone can run before the reorder commits.
  useLayoutEffect(() => {
    if (draggingId) applyLift();
  });

  // FLIP: glide every other card from its previous slot to its new one.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reduce = reduceMotion();
    container.querySelectorAll<HTMLElement>("[data-monitor-id]").forEach((el) => {
      const id = el.dataset.monitorId!;
      const top = el.getBoundingClientRect().top;
      const prev = lastTops.current.get(id);
      lastTops.current.set(id, top);
      if (prev == null || prev === top || id === draggingId || reduce) return;
      el.animate(
        [{ transform: `translateY(${prev - top}px)` }, { transform: "translateY(0)" }],
        { duration: FLIP_MS, easing: EASE },
      );
    });
  }, [preview, draggingId, containerRef]);

  return { draggingId, preview, indicatorY, start, move };
}
