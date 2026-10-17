// The store behind the api client's primed responses (see client/api.ts): one
// in-flight response per key, taken at most once. Each entry expires `ttlMs`
// after it was primed, so a prime nobody consumed — the dock answering a day
// re-open from its own fresh cache, say — can't be served minutes later in
// place of a real fetch (a standings refresh missing the run you just made).
// Boot's primes are consumed within the first render, well inside the window.
export const primePool = <T>(ttlMs: number, now: () => number = Date.now) => {
  const entries = new Map<string, { value: T; at: number }>();
  return {
    set: (key: string, value: T) => {
      const t = now();
      // Sweep what expired untaken, so the pool can't accumulate.
      for (const [k, e] of entries) if (t - e.at > ttlMs) entries.delete(k);
      entries.set(key, { value, at: t });
    },
    // Restart an entry's window, if `value` is still the one primed under
    // `key` — for an in-flight response, from when it actually arrived.
    touch: (key: string, value: T) => {
      const e = entries.get(key);
      if (e?.value === value) e.at = now();
    },
    // The primed value, removed from the pool; undefined when there is none
    // or it has expired (an expired one is dropped on the way).
    take: (key: string): T | undefined => {
      const e = entries.get(key);
      if (!e) return undefined;
      entries.delete(key);
      return now() - e.at <= ttlMs ? e.value : undefined;
    },
  };
};
