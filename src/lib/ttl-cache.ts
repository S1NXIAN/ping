/**
 * Tiny in-process TTL cache for expensive, read-only computations. One entry
 * per key; entries older than `ttlMs` are recomputed. No timers — expiry is
 * checked on read, so an idle instance holds nothing alive.
 *
 * PING's public status page rebuilds a full fleet aggregate on every request;
 * a short TTL stops a refresh loop or crawler from re-running it each time.
 * The window is well under the page's own refresh interval, so the data
 * shown stays current. Concurrent misses for the same key share one compute
 * (the promise is stored), so a burst of hits does one rebuild, not N.
 */
export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return {
    get(key: string, compute: () => Promise<T>): Promise<T> {
      const hit = store.get(key);
      if (hit) {
        if (Date.now() - hit.at < ttlMs) return hit.value;
        store.delete(key); // expired — evict rather than leave it behind
      }
      const value = compute();
      store.set(key, { at: Date.now(), value });
      // A rejected compute must not be cached — drop it so the next call retries.
      value.catch(() => store.delete(key));
      return value;
    },
  };
}
