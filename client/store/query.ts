// A minimal keyed query helper: coalesces concurrent callers for a key onto one
// in-flight request, serves the entry while it's fresh, and frees the key when
// the fetch rejects so the next call retries instead of being served the
// failure.
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
      // Only evict if the entry is still this fetch; a bust and refill may
      // have replaced it.
      if (entries.get(key) === next) entries.delete(key);
    });
    return promise;
  };

  // Drop a key so the next get refetches.
  get.bust = (key: K) => {
    entries.delete(key);
  };

  // Milliseconds since the key's entry was fetched, or Infinity if absent. Lets
  // a caller skip a bust while the entry is very fresh.
  get.age = (key: K) => {
    const entry = entries.get(key);
    return entry ? Date.now() - entry.at : Infinity;
  };

  return get;
};
