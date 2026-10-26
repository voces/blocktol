// A Map that keeps at most `maxSize` entries, evicting the least recently used.
// A value is never undefined, so `get`'s undefined always means absent.
export class LRUMap<K, V extends {} | null> extends Map<K, V> {
  maxSize: number;

  constructor(options?: { maxSize?: number }) {
    super();

    this.maxSize = options?.maxSize ?? 1_000_000;
  }

  override set(key: K, value: V) {
    super.delete(key);
    super.set(key, value);
    this.#evict();
    return this;
  }

  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) this.set(key, value);
    return value;
  }

  override has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  getAndSet(key: K, setter: (old: V | undefined) => V) {
    const value = setter(super.get(key));
    this.set(key, value);
    return value;
  }

  // Oldest first: a Map iterates in insertion order, and every read re-inserts.
  #evict() {
    for (const key of super.keys()) {
      if (super.size <= this.maxSize) return;
      super.delete(key);
    }
  }
}
