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
    // deno-lint-ignore ban-types
    new WeakMap<object, unknown>(),
  ] as const;

  const dive = (...args: Args) => {
    let cur = root;
    for (let i = 0; i < args.length - 1; i++) {
      const arg = args[i];
      if (is.record(is.unknown)(arg)) {
        const curChild = cur[1].get(arg);
        if (!curChild) {
          const next = [new Map(), new WeakMap()] as const;
          cur[1].set(arg, next);
          cur = next;
        } else cur = curChild as typeof root;
      } else {
        const curChild = cur[0].get(args[i]);
        if (!curChild) {
          const next = [new Map(), new WeakMap()] as const;
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

const isResolved = async (promise: Promise<unknown>) => {
  const resolved = Symbol("resolved");
  const p = await Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(resolved), 1)),
  ]);
  return p === resolved;
};

export const trailer = <
  // Value,
  // PValue extends Promise<Value>,
  // deno-lint-ignore no-explicit-any
  Fn extends (...args: any[]) => Promise<any>,
>(
  fn: Fn,
) =>
  memoize((...args: Parameters<Fn>): () => Promise<ReturnType<Fn>> => {
    let promise = fn(...args);
    let v: Awaited<ReturnType<Fn>>;
    let hasResolvedAtLeastOnce = false;

    return async () => {
      if (!hasResolvedAtLeastOnce) {
        v = await promise;
        hasResolvedAtLeastOnce = true;
      } else if (await isResolved(promise)) {
        v = await promise;
        promise = fn(...args);
      }

      return v;
    };
  });
