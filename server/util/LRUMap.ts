export class LRUMap<K, V> extends Map<K, V> {
  maxSize: number;

  constructor(options?: { maxSize?: number }) {
    super();

    this.maxSize = options?.maxSize ?? 1_000_000;
  }

  set(key: K, value: V) {
    super.delete(key);
    super.set(key, value);

    if (super.size > this.maxSize) {
      const itr = super.keys();
      let result = itr.next();
      while (super.size > this.maxSize && !result.done) {
        super.delete(result.value);
        result = itr.next();
      }
    }

    return this;
  }

  get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key);
    super.delete(key);
    super.set(key, value!);

    if (super.size > this.maxSize) {
      const itr = super.keys();
      let result = itr.next();
      while (super.size > this.maxSize && !result.done) {
        super.delete(result.value);
        result = itr.next();
      }
    }

    return value;
  }

  has(key: K): boolean {
    if (!super.has(key)) return false;
    const value = super.get(key);
    super.delete(key);
    super.set(key, value!);

    if (super.size > this.maxSize) {
      const itr = super.keys();
      let result = itr.next();
      while (super.size > this.maxSize && !result.done) {
        super.delete(result.value);
        result = itr.next();
      }
    }

    return true;
  }

  getAndSet(key: K, setter: (old: V | undefined) => V) {
    const value = setter(super.get(key));
    this.set(key, value);
    return value;
  }
}
