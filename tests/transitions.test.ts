// isTransition decides which status changes raise a webhook. Expected values
// are the spec: notify on entering "down" and on the "down"→"up" recovery.
import { expect, test } from "bun:test";
import { isTransition } from "@/lib/webhooks";

test("first-ever down raises a down event", () => {
  expect(isTransition(null, "down")).toBe("down");
  expect(isTransition(undefined, "down")).toBe("down");
  expect(isTransition("unknown", "down")).toBe("down");
});

test("staying down raises nothing (no per-check spam)", () => {
  expect(isTransition("down", "down")).toBe(null);
});

test("recovery raises an up event", () => {
  expect(isTransition("down", "up")).toBe("up");
});

test("first-ever up raises nothing", () => {
  expect(isTransition(null, "up")).toBe(null);
  expect(isTransition("up", "up")).toBe(null);
});
