// No live code imports this since the legacy grid pathfinder was removed, but
// it stays: scripts/comparePathViz.ts drops a HISTORICAL common/pathing.ts
// (from a git ref) next to its sibling modules and imports it directly, and
// those baselines import ./MMap.ts. Deleting this breaks comparing against any
// pre-PathSolver ref.
type NestedMap<K, V> = Map<K, V | NestedMap<K, V>>;

export class MMap<K extends unknown[], V> {
  #store = new Map<K[number], V | NestedMap<K[number], V>>();
  #fn: ((...keys: K) => V) | undefined;

  constructor(fn?: (...keys: K) => V) {
    this.#fn = fn;
  }

  #getFinalNode(keys: K) {
    let cur = this.#store;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!cur.has(keys[i])) cur.set(keys[i], new Map());
      cur = cur.get(keys[i]) as NestedMap<K, V>;
    }
    return cur;
  }

  set(value: V, ...keys: K) {
    this.#getFinalNode(keys).set(keys[keys.length - 1], value);
    return value;
  }

  get(...keys: K) {
    return this.#getFinalNode(keys).get(keys[keys.length - 1]) as V | undefined;
  }

  getOrSet(...keys: K) {
    const node = this.#getFinalNode(keys);
    if (node.has(keys[keys.length - 1])) {
      return node.get(keys[keys.length - 1]) as V;
    }
    if (!this.#fn) throw new Error("getOrSet called without passing fn");
    const value = this.#fn(...keys);
    node.set(keys[keys.length - 1], value);
    return value;
  }
}
