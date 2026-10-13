// Reorder math, pure and DOM-free: the splice used by the drag session and the
// card menu's Move up/down, and the pin-zone rule that decides whether a moved
// monitor lands pinned. Expected values come from worked examples, not the
// implementation — see GLOSSARY.md ("Monitor status") and the pinned-zone rule
// in the dashboard's reorder engine.
import { expect, test } from "bun:test";
import { moveByStep, pinnedSetAfterMove, reorder } from "@/lib/reorder";

const ids = (...names: string[]) => names.map((id) => ({ id, pinned: false }));

test("reorder moves an item to a later index", () => {
  expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
});

test("reorder moves an item to an earlier index", () => {
  expect(reorder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
});

test("reorder does not mutate its input", () => {
  const list = ["a", "b", "c"];
  reorder(list, 0, 2);
  expect(list).toEqual(["a", "b", "c"]);
});

test("moveByStep steps down past the visible neighbour", () => {
  const items = ids("a", "b", "c");
  expect(moveByStep(items, ["a", "b", "c"], "a", 1)?.map((m) => m.id)).toEqual(["b", "a", "c"]);
});

test("moveByStep steps up past the visible neighbour", () => {
  const items = ids("a", "b", "c");
  expect(moveByStep(items, ["a", "b", "c"], "c", -1)?.map((m) => m.id)).toEqual(["a", "c", "b"]);
});

test("moveByStep refuses to step past either end", () => {
  const items = ids("a", "b", "c");
  expect(moveByStep(items, ["a", "b", "c"], "a", -1)).toBeNull();
  expect(moveByStep(items, ["a", "b", "c"], "c", 1)).toBeNull();
});

test("moveByStep ignores an id that is not in the visible order", () => {
  expect(moveByStep(ids("a", "b"), ["a", "b"], "zz", 1)).toBeNull();
});

test("moveByStep in a filtered view steps past the visible neighbour and keeps hidden order", () => {
  // Full order a,b,c,d,e; the filter shows only b and d. Moving b down must land
  // it after d (its visible neighbour), leaving a, c and e in place.
  const items = ids("a", "b", "c", "d", "e");
  const next = moveByStep(items, ["b", "d"], "b", 1);
  expect(next?.map((m) => m.id)).toEqual(["a", "c", "d", "b", "e"]);
});

test("pinnedSetAfterMove pins a card dropped inside the pinned zone", () => {
  const list = [
    { id: "p1", pinned: true },
    { id: "p2", pinned: true },
    { id: "x", pinned: false },
    { id: "y", pinned: false },
  ];
  // x moved to index 1 — strictly inside the two pinned others — so it pins.
  const moved = [list[0], list[2], list[1], list[3]];
  expect(pinnedSetAfterMove(moved, "x")).toEqual(new Set(["p1", "p2", "x"]));
});

test("pinnedSetAfterMove unpins a card dropped at the boundary", () => {
  const list = [
    { id: "p1", pinned: true },
    { id: "x", pinned: true },
    { id: "p2", pinned: true },
    { id: "y", pinned: false },
  ];
  // x moved below the OTHER pinned block (p1, p2) — at the first unpinned slot.
  const moved = [list[0], list[2], list[1], list[3]];
  expect(pinnedSetAfterMove(moved, "x")).toEqual(new Set(["p1", "p2"]));
});

test("pinnedSetAfterMove leaves other cards' pin states alone", () => {
  const list = [
    { id: "p1", pinned: true },
    { id: "p2", pinned: true },
    { id: "y", pinned: false },
    { id: "z", pinned: false },
  ];
  // y moved below the pinned block: y stays unpinned, p1/p2 keep theirs.
  const moved = [list[0], list[1], list[3], list[2]];
  expect(pinnedSetAfterMove(moved, "y")).toEqual(new Set(["p1", "p2"]));
});

test("pinnedSetAfterMove unpins the only pinned monitor, since no other pinned block exists", () => {
  // The rule is positional: you pin by landing inside the block of OTHER pinned
  // monitors. With none, there is no block, so the moved card unpins. Preserved
  // from the original engine, documented here so it is a decision, not a surprise.
  const list = [
    { id: "p1", pinned: true },
    { id: "y", pinned: false },
  ];
  expect(pinnedSetAfterMove(list, "p1")).toEqual(new Set());
});
