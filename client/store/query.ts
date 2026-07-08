// A minimal keyed query helper: coalesces concurrent callers for a key onto
// one in-flight request, serves the entry without refetching while it's
// fresh, and frees the key when the fetch rejects so the next call retries
// instead of being served the failure. The generalized form of what the
// profile cache and the calendar's month bookkeeping each hand-rolled.
export const keyedQuery = <K, T>(
  fetcher: (key: K) => Promise<T>,
  { staleMs = Infinity }: { staleMs?: number } = {},
) => {
  const entries = new Map<K, { at: number; promise: Promise<T> }>();

  const get = (key: K): Promise<T> => {
    const entry = entries.get(key);
    if (entry && Date.now() - entry.at < staleMs) return entry.promise;
    const promise = fetcher(key);
    const next = { at: Date.now(), promise };
    entries.set(key, next);
    promise.catch(() => {
      // Guarded delete: only evict if the entry is still this fetch (a bust +
      // refill may have replaced it).
      if (entries.get(key) === next) entries.delete(key);
    });
    return promise;
  };

  // Drop a key so the next get refetches (e.g. data known to have changed).
  get.bust = (key: K) => {
    entries.delete(key);
  };

  return get;
};
