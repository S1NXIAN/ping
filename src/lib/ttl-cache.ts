/**
 * Tiny in-process TTL cache for expensive, read-only computations. One entry
 * per key; entries older than `ttlMs` are recomputed. No timers — expiry is
 * checked on read, so an idle instance holds nothing alive.
 *
 * PING's public status page rebuilds a full fleet aggregate on every request;
 * a short TTL stops a refresh loop or crawler from re-running it each time.
 * The window is well under the page's own refresh interval, so the data
 * shown stays current.
 */
export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, { at: number; value: T }>();
  return {
    async get(key: string, compute: () => Promise<T>): Promise<T> {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      const value = await compute();
      store.set(key, { at: Date.now(), value });
      return value;
    },
    clear() {
      store.clear();
    },
  };
}
