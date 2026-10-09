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

test("concurrent misses for one key share a single compute", async () => {
  const cache = createTtlCache<number>(1000);
  let calls = 0;
  const compute = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return calls;
  };
  const [a, b, c] = await Promise.all([
    cache.get("k", compute),
    cache.get("k", compute),
    cache.get("k", compute),
  ]);
  expect(calls).toBe(1);
  expect([a, b, c]).toEqual([1, 1, 1]);
});

test("a rejected compute is not cached", async () => {
  const cache = createTtlCache<number>(1000);
  let calls = 0;
  const compute = async () => {
    calls += 1;
    if (calls === 1) throw new Error("boom");
    return calls;
  };
  await expect(cache.get("k", compute)).rejects.toThrow("boom");
  expect(await cache.get("k", compute)).toBe(2);
});
