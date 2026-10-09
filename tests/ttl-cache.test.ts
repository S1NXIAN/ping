import { expect, test } from "bun:test";
import { createTtlCache } from "@/lib/ttl-cache";

test("computes once within the TTL window", async () => {
  const cache = createTtlCache<number>(1000);
  let calls = 0;
  const compute = async () => ++calls;
  expect(await cache.get("k", compute)).toBe(1);
  expect(await cache.get("k", compute)).toBe(1);
  expect(calls).toBe(1);
});

test("separate keys are cached separately", async () => {
  const cache = createTtlCache<string>(1000);
  let calls = 0;
  const compute = async () => `v${++calls}`;
  expect(await cache.get("a", compute)).toBe("v1");
  expect(await cache.get("b", compute)).toBe("v2");
});

test("recomputes after the TTL expires", async () => {
  const cache = createTtlCache<number>(10);
  let calls = 0;
  const compute = async () => ++calls;
  expect(await cache.get("k", compute)).toBe(1);
  await new Promise((r) => setTimeout(r, 25));
  expect(await cache.get("k", compute)).toBe(2);
});
