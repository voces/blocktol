import { test } from "node:test";
import {
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { boundedTrailer, memoize, trailer } from "./memoize.ts";

test("memoize", async (t) => {
  await t.test("single primitive arg", () => {
    const fn = (v: number) => ({ v: v * 2 });
    const m = memoize(fn);
    const first = m(3);

    assertStrictEquals(m(3), first);
    assertNotStrictEquals(m(4), first);
  });

  await t.test("single object arg", () => {
    const fn = (o: { v: number }) => ({ v: o.v * 2 });
    const m = memoize(fn);
    const a = { v: 3 };
    const first = m(a);

    assertStrictEquals(m(a), first);
    assertNotStrictEquals(m({ v: 3 }), first);
  });

  await t.test("nested args", () => {
    const fn = (a: number, b: number) => ({ v: a ** b });
    const m = memoize(fn);
    const first = m(3, 5);

    assertStrictEquals(m(3, 5), first);
    assertNotStrictEquals(m(3, 6), first);
    assertNotStrictEquals(m(4, 5), first);
  });
});

test("clear", () => {
  const fn = (v: number) => ({ v: v * 2 });
  const m = memoize(fn);
  const first = m(3);
  m.clear();

  assertNotStrictEquals(m(3), first);
});

test("bust", () => {
  const fn = (v: number) => ({ v: v * 2 });
  const m = memoize(fn);
  const first3 = m(3);
  const first5 = m(5);
  m.bust(3);

  assertNotStrictEquals(m(3), first3);
  assertStrictEquals(m(5), first5);
});

test("rejected promises are evicted, not cached", async () => {
  let calls = 0;
  const fn = (v: number) => {
    calls++;
    return calls === 1
      ? Promise.reject(new Error("transient"))
      : Promise.resolve(v * 2);
  };
  const m = memoize(fn);

  await assertRejects(() => m(3), Error, "transient");
  // The rejection must not be served from cache — the next call retries.
  assertStrictEquals(await m(3), 6);
  assertStrictEquals(calls, 2);
  // And the successful result is cached as usual.
  assertStrictEquals(await m(3), 6);
  assertStrictEquals(calls, 2);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("trailer", async (t) => {
  await t.test("initial rejection retries on the next call", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return calls === 1
        ? Promise.reject(new Error("transient"))
        : Promise.resolve(calls);
    };
    const get = trailer(fn)();

    await assertRejects(() => get(), Error, "transient");
    assertStrictEquals(await get(), 2);
  });

  await t.test("failed refresh keeps serving the stale value", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return calls === 2
        ? Promise.reject(new Error("transient"))
        : Promise.resolve(calls);
    };
    const get = trailer(fn)();

    assertStrictEquals(await get(), 1);
    await tick(); // let the refresh kicked by the next call settle
    // Call 2's value is the settled call-1 fetch; it kicks refresh #2 (which
    // rejects). The stale 1 keeps being served, then refresh #3 succeeds.
    assertStrictEquals(await get(), 1);
    await tick();
    assertStrictEquals(await get(), 1);
    await tick();
    assertStrictEquals(await get(), 3);
    // Let the last isSettled race's 1ms timer fire before the step ends, so no
    // timer outlives the test (node:test reports no leak; nothing else would).
    await tick();
  });
});

test("boundedTrailer keeps at most maxSize keys, LRU first out", async () => {
  const calls: string[] = [];
  const fn = (a: number, b: string) => {
    calls.push(`${a}:${b}`);
    return Promise.resolve(`${a}:${b}`);
  };
  const get = boundedTrailer(fn, 2);

  assertStrictEquals(await get(1, "x")(), "1:x");
  assertStrictEquals(get(1, "x"), get(1, "x")); // same key, same getter
  assertStrictEquals(await get(2, "y")(), "2:y");
  get(1, "x"); // touch 1:x so 2:y is now the least recently used
  assertStrictEquals(await get(3, "z")(), "3:z"); // evicts 2:y
  assertStrictEquals(calls.length, 3);

  get(1, "x"); // still cached: no new fetch
  assertStrictEquals(calls.length, 3);
  assertStrictEquals(await get(2, "y")(), "2:y"); // evicted: fetched afresh
  assertStrictEquals(calls.length, 4);
});
