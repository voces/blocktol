import { is } from "../../common/typeguards.ts";
import { LRUMap } from "./LRUMap.ts";

// deno-lint-ignore no-explicit-any
type GetLength<original extends any[]> = original extends { length: infer L }
  ? L
  : never;

// A trie keyed by argument identity: each non-last argument selects a child
// level, object arguments through a WeakMap (so they can be collected) and
// primitives through a Map. `dive(...args)` returns the last level's store for
// the final argument.
// deno-lint-ignore no-explicit-any
export const wrapperStore = <Args extends any[], Value>() => {
  // TODO: should have different roots for each args.length
  const root = [
    new Map<unknown, unknown>(),
    new WeakMap<object, unknown>(),
  ] as const;

  const dive = (...args: Args) => {
    let cur = root;
    for (let i = 0; i < args.length - 1; i++) {
      const arg = args[i];
      if (is.record(is.unknown)(arg)) {
        const curChild = cur[1].get(arg);
        if (!curChild) {
          const next: typeof root = [new Map(), new WeakMap()];
          cur[1].set(arg, next);
          cur = next;
        } else cur = curChild as typeof root;
      } else {
        const curChild = cur[0].get(args[i]);
        if (!curChild) {
          const next: typeof root = [new Map(), new WeakMap()];
          cur[0].set(args[i], next);
          cur = next;
        } else cur = curChild as typeof root;
      }
    }

    const arg = args[args.length - 1];
    return cur[is.record(is.unknown)(arg) ? 1 : 0] as WeakMap<
      Args[GetLength<Args>],
      Value
    >;
  };

  return dive;
};

// deno-lint-ignore no-explicit-any
export const memoize = <Fn extends (...args: any[]) => any>(fn: Fn) => {
  let dive = wrapperStore<Parameters<Fn>, ReturnType<Fn>>();

  const memoizedFn = (...args: Parameters<Fn>): ReturnType<Fn> => {
    const container = dive(...args);
    const arg = args[args.length - 1];
    if (container.has(arg)) return container.get(arg) as ReturnType<Fn>;
    const value = fn(...args) as ReturnType<Fn>;
    container.set(arg, value);
    // Evict on rejection, or one transient error would poison the entry for
    // every later caller. Only if the entry is still this promise (a
    // clear/bust + refill may have replaced it).
    if ((value as unknown) instanceof Promise) {
      (value as Promise<unknown>).catch(() => {
        if (container.get(arg) === value) container.delete(arg);
      });
    }
    return value;
  };

  const clear = () => {
    dive = wrapperStore<Parameters<Fn>, ReturnType<Fn>>();
  };

  const bust = (...args: Parameters<Fn>) => {
    const container = dive(...args);
    const arg = args[args.length - 1];
    container.delete(arg);
  };

  return Object.assign(memoizedFn, { clear, bust });
};

// Whether the promise has settled (resolved OR rejected). The candidate is
// wrapped so the race never throws on a rejection.
const isSettled = async (promise: Promise<unknown>) => {
  const pending = Symbol("pending");
  const p = await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise((resolve) => setTimeout(() => resolve(pending), 1)),
  ]);
  return p !== pending;
};

// One stale-while-revalidate getter over `fetch`: the first call awaits the
// first fetch; later calls serve the last good value and start a refresh once
// the previous one has settled. The per-key body of `trailer` and
// `boundedTrailer`.
const staleWhileRevalidate = <T>(fetch: () => Promise<T>) => {
  // The no-op catch keeps a background refresh that rejects before anyone
  // awaits it from tripping Deno's unhandledrejection. Awaiters still see it.
  const kick = () => {
    const p = fetch();
    p.catch(() => {});
    return p;
  };
  let promise = kick();
  let v: T;
  let hasResolvedAtLeastOnce = false;

  return async () => {
    if (!hasResolvedAtLeastOnce) {
      // No stale value to fall back on: surface the failure, but swap in a
      // fresh fetch so the next call retries. The identity check stops
      // concurrent rejected awaiters each starting their own retry.
      const p = promise;
      try {
        v = await p;
        hasResolvedAtLeastOnce = true;
      } catch (err) {
        if (promise === p) promise = kick();
        throw err;
      }
    } else if (await isSettled(promise)) {
      // Take the settled refresh if it succeeded, keep the stale value if it
      // failed, and start the next refresh either way.
      const p = promise;
      try {
        v = await p;
      } catch { /* keep the stale value */ }
      if (promise === p) promise = kick();
    }

    return v;
  };
};

export const trailer = <
  // deno-lint-ignore no-explicit-any
  Fn extends (...args: any[]) => Promise<any>,
>(
  fn: Fn,
) =>
  memoize((...args: Parameters<Fn>): () => Promise<Awaited<ReturnType<Fn>>> =>
    staleWhileRevalidate(() => fn(...args))
  );

// `trailer` holding at most `maxSize` keys, least-recently-used evicted first.
// `trailer` keeps every argument tuple it has seen forever: fine for a handful
// of keys, a leak for per-(iteration, user) keys. An evicted key starts over
// with a fresh awaited fetch. Keys are the args' JSON, so use primitive args
// only.
export const boundedTrailer = <
  // deno-lint-ignore no-explicit-any
  Fn extends (...args: any[]) => Promise<any>,
>(
  fn: Fn,
  maxSize: number,
) => {
  const getters = new LRUMap<
    string,
    () => Promise<Awaited<ReturnType<Fn>>>
  >({ maxSize });
  return (...args: Parameters<Fn>) => {
    const key = JSON.stringify(args);
    let get = getters.get(key);
    if (!get) {
      get = staleWhileRevalidate(() => fn(...args));
      getters.set(key, get);
    }
    return get;
  };
};
