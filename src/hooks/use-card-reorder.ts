"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { moveByStep, reorder } from "@/lib/reorder";

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
 *
 * Commits are serialized on a promise chain, and each new step is computed from
 * the optimistic order rather than the last server response. Two quick taps
 * therefore both land instead of the second being swallowed by the first.
 */

/** One rendered card: its layout band (transform-free), plus its index in `items`. */
interface Slot {
  /** Layout offset within the list container — unaffected by the lift transform. */
  offsetTop: number;
  height: number;
  /** Index in the full `items` array — the splice target. */
  itemIndex: number;
}

interface Options<T extends { id: string }> {
  /** The full manual-order list — stable identity (server order). */
  items: T[];
  /** The list container; every card carries `data-monitor-id`. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Persist one order. Resolves once the server's fresh order has landed, so
   *  the preview can be held until then and the list never snaps back. */
  onCommit: (next: T[], movedId: string) => Promise<void>;
  /** Reorder is available (manual sort, more than one monitor). */
  enabled: boolean;
}

export interface CardReorder<T> {
  /** The card being dragged, or null. */
  draggingId: string | null;
  /** Live optimistic order while a reorder is in flight; null when idle. */
  preview: T[] | null;
  /** Y (px, relative to the list container) for the insertion indicator. */
  indicatorY: number | null;
  /** Start a drag from a card's handle. */
  start: (id: string, e: React.PointerEvent) => void;
  /** Step a card one slot through the visible order — the keyboard- and
   *  touch-reachable path (the grip handle is desktop-only). */
  move: (id: string, dir: -1 | 1, visibleIds: string[]) => void;
}

const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const FLIP_MS = 190;
/** A press that never travels this far is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;
/** How long a post-drag click is swallowed so it can't also open the card. */
const CLICK_GUARD_MS = 250;
/** Distance from a viewport edge at which a drag starts scrolling the page. */
const AUTOSCROLL_MARGIN_PX = 90;
const AUTOSCROLL_SPEED_PX = 14;

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
  /** The optimistic order not yet confirmed by the server; null when settled. */
  const optimisticRef = useRef<T[] | null>(null);
  const pointerY = useRef(0);
  const grabOffset = useRef(0);
  const slotRef = useRef(-1);
  const startSlot = useRef(-1);
  const containerTop = useRef(0);
  const moved = useRef(false);
  /** Active drag teardown, so the session can be ended from anywhere. */
  const detach = useRef<(() => void) | null>(null);
  /** Serializes commits so overlapping reorders queue instead of dropping. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  /** Card id → viewport top, for the FLIP diff between renders. */
  const lastTops = useRef(new Map<string, number>());

  const reduceMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Show `list` optimistically and commit it once the in-flight one settles.
   *  The preview clears only when this list is still the newest, so a burst of
   *  steps holds one continuous optimistic order. */
  const enqueue = useCallback(
    (list: T[], movedId: string) => {
      optimisticRef.current = list;
      setPreview(list);
      chain.current = chain.current
        .then(() => onCommit(list, movedId))
        .catch(() => undefined)
        .then(() => {
          if (optimisticRef.current === list) {
            optimisticRef.current = null;
            setPreview(null);
          }
        });
    },
    [onCommit],
  );

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

  /** Viewport Y of a rendered slot's midpoint. Derived from the container's
   *  current position, so it stays correct after a scroll. */
  const slotMid = useCallback(
    (s: Slot) => containerTop.current + s.offsetTop + s.height / 2,
    [],
  );

  /** The rendered-slot index under the pointer, from the band midpoints. */
  const slotAt = useCallback(
    (y: number) => {
      const s = slots.current;
      for (let i = 0; i < s.length; i++) {
        if (y < slotMid(s[i])) return i;
      }
      return s.length - 1;
    },
    [slotMid],
  );

  /** Step a card one slot through the visible order, committing like a drop. */
  const move = useCallback(
    (id: string, dir: -1 | 1, visibleIds: string[]) => {
      if (!enabled || detach.current) return;
      // Base on the optimistic order when one is pending, so consecutive steps
      // compose rather than each starting from the stale server order.
      const next = moveByStep(optimisticRef.current ?? items, visibleIds, id, dir);
      if (!next) return;
      enqueue(next, id);
    },
    [enabled, items, enqueue],
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
        if (el === card) draggedSlot = s.length;
        s.push({ offsetTop: el.offsetTop, height: el.offsetHeight, itemIndex });
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
      grabOffset.current = e.clientY - (containerTop.current + s[draggedSlot].offsetTop);
      slotRef.current = draggedSlot;
      startSlot.current = draggedSlot;
      moved.current = false;
      setDraggingId(id);
      setPreview(items);
      setIndicatorY(s[draggedSlot].offsetTop);
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        pointerY.current = ev.clientY;
        const travel =
          ev.clientY - grabOffset.current - (containerTop.current + slots.current[startSlot.current].offsetTop);
        if (!moved.current && Math.abs(travel) > DRAG_THRESHOLD_PX) moved.current = true;
        applyLift();

        const next = slotAt(ev.clientY);
        if (next === slotRef.current) return;
        slotRef.current = next;

        // Splice the FULL list at the target's index in it, so a filtered view
        // reorders the same way an unfiltered one does.
        const list = optimisticRef.current ?? items;
        const from = list.findIndex((m) => m.id === id);
        const to = slots.current[next].itemIndex;
        if (from < 0 || from === to) return;
        const copy = reorder(list, from, to);
        optimisticRef.current = copy;
        setPreview(copy);
        setIndicatorY(slots.current[next].offsetTop);
      };

      // Keep the slot bands honest if the page scrolls mid-drag, and nudge the
      // page when the pointer nears an edge so long lists are reachable.
      const onScroll = () => {
        containerTop.current = container.getBoundingClientRect().top;
        applyLift();
      };
      let raf = requestAnimationFrame(function tick() {
        const y = pointerY.current;
        if (y < AUTOSCROLL_MARGIN_PX) window.scrollBy(0, -AUTOSCROLL_SPEED_PX);
        else if (y > window.innerHeight - AUTOSCROLL_MARGIN_PX)
          window.scrollBy(0, AUTOSCROLL_SPEED_PX);
        raf = requestAnimationFrame(tick);
      });

      /** Reset everything the session touched — safe to call twice. */
      const teardown = () => {
        cancelAnimationFrame(raf);
        if (draggedEl.current) draggedEl.current.style.transform = "";
        document.body.style.userSelect = "";
        draggedEl.current = null;
      };

      const finish = () => {
        detach.current?.();
        detach.current = null;
        const el = draggedEl.current;
        const dragged = moved.current;
        const list = optimisticRef.current;
        const changed = dragged && startSlot.current !== slotRef.current;
        teardown();

        // Swallow the click the browser may fire after a drag so it can't also
        // open the detail sheet. Self-clears on the click, or after a short
        // grace period if none comes — so it can never eat a later deliberate
        // click. shortcut: a real click within CLICK_GUARD_MS of a drop is
        // ignored; too fast to hit by hand, upgrade if it ever bites.
        if (dragged && el) {
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

        setDraggingId(null);
        setIndicatorY(null);
        if (changed && list) enqueue(list, id);
        else if (optimisticRef.current == null) setPreview(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("scroll", onScroll, { passive: true });
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        window.removeEventListener("scroll", onScroll);
      };
    },
    [containerRef, enabled, items, enqueue, applyLift, slotAt],
  );

  // A drag outliving the component (unmount mid-drag) must not leak listeners,
  // the body's user-select lock, or a stale transform.
  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
      document.body.style.userSelect = "";
      if (draggedEl.current) draggedEl.current.style.transform = "";
      draggedEl.current = null;
    },
    [],
  );

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
