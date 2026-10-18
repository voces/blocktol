// The store behind the api client's primed responses (see client/api.ts): one
// in-flight response per key, taken at most once. An entry expires `ttlMs`
// after it was primed, so a prime nobody consumed (the dock serving a day from
// its own cache, say) can't answer a later fetch with stale data, e.g. a
// standings refresh missing the run you just made.
export const primePool = <T>(ttlMs: number, now: () => number = Date.now) => {
  const entries = new Map<string, { value: T; at: number }>();
  return {
    set: (key: string, value: T) => {
      const t = now();
      // Sweep entries that expired untaken.
      for (const [k, e] of entries) if (t - e.at > ttlMs) entries.delete(k);
      entries.set(key, { value, at: t });
    },
    // Restart an entry's window if `value` is still the one primed under `key`,
    // so an in-flight response is timed from when it arrived.
    touch: (key: string, value: T) => {
      const e = entries.get(key);
      if (e?.value === value) e.at = now();
    },
    // The primed value, removed from the pool; undefined when none or expired.
    take: (key: string): T | undefined => {
      const e = entries.get(key);
      if (!e) return undefined;
      entries.delete(key);
      return now() - e.at <= ttlMs ? e.value : undefined;
    },
  };
};
