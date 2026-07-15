import { is } from "../../common/typeguards.ts";

// deno-lint-ignore no-explicit-any
type GetLength<original extends any[]> = original extends { length: infer L }
  ? L
  : never;

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
    // A cached rejected promise would serve the failure to every later caller
    // (one transient error permanently poisons the entry) — evict on rejection
    // so the next call retries. Guarded delete: only evict if the entry is
    // still this promise (a clear/bust + refill may have replaced it).
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

// Whether the promise has settled (resolved OR rejected) — the race must not
// itself throw on a rejected promise, so the candidate is wrapped.
const isSettled = async (promise: Promise<unknown>) => {
  const pending = Symbol("pending");
  const p = await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise((resolve) => setTimeout(() => resolve(pending), 1)),
  ]);
  return p !== pending;
};

export const trailer = <
  // deno-lint-ignore no-explicit-any
  Fn extends (...args: any[]) => Promise<any>,
>(
  fn: Fn,
) =>
  memoize((...args: Parameters<Fn>): () => Promise<ReturnType<Fn>> => {
    // Every fetch gets a no-op rejection handler attached at creation: a
    // background refresh that rejects before anyone awaits it would otherwise
    // trip Deno's unhandledrejection. Awaiters still see the rejection.
    const kick = () => {
      const p = fn(...args);
      p.catch(() => {});
      return p;
    };
    let promise = kick();
    let v: Awaited<ReturnType<Fn>>;
    let hasResolvedAtLeastOnce = false;

    return async () => {
      if (!hasResolvedAtLeastOnce) {
        // No stale value to fall back on: surface the failure, but swap in a
        // fresh fetch first so the next call retries instead of awaiting the
        // same rejected promise forever. The identity check keeps concurrent
        // rejected awaiters from each kicking off their own retry.
        const p = promise;
        try {
          v = await p;
          hasResolvedAtLeastOnce = true;
        } catch (err) {
          if (promise === p) promise = kick();
          throw err;
        }
      } else if (await isSettled(promise)) {
        // Stale-while-revalidate: take the settled refresh if it succeeded —
        // keep serving the stale value if it failed — and kick off the next
        // refresh either way.
        const p = promise;
        try {
          v = await p;
        } catch { /* keep the stale value */ }
        if (promise === p) promise = kick();
      }

      return v;
    };
  });
