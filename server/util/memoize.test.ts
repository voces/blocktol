import {
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { memoize, trailer } from "./memoize.ts";

Deno.test("memoize", async (t) => {
  await t.step("single primitive arg", () => {
    const fn = (v: number) => ({ v: v * 2 });
    const m = memoize(fn);
    const first = m(3);

    assertStrictEquals(m(3), first);
    assertNotStrictEquals(m(4), first);
  });

  await t.step("single object arg", () => {
    const fn = (o: { v: number }) => ({ v: o.v * 2 });
    const m = memoize(fn);
    const a = { v: 3 };
    const first = m(a);

    assertStrictEquals(m(a), first);
    assertNotStrictEquals(m({ v: 3 }), first);
  });

  await t.step("nested args", () => {
    const fn = (a: number, b: number) => ({ v: a ** b });
    const m = memoize(fn);
    const first = m(3, 5);

    assertStrictEquals(m(3, 5), first);
    assertNotStrictEquals(m(3, 6), first);
    assertNotStrictEquals(m(4, 5), first);
  });
});

Deno.test("clear", () => {
  const fn = (v: number) => ({ v: v * 2 });
  const m = memoize(fn);
  const first = m(3);
  m.clear();

  assertNotStrictEquals(m(3), first);
});

Deno.test("bust", () => {
  const fn = (v: number) => ({ v: v * 2 });
  const m = memoize(fn);
  const first3 = m(3);
  const first5 = m(5);
  m.bust(3);

  assertNotStrictEquals(m(3), first3);
  assertStrictEquals(m(5), first5);
});

Deno.test("rejected promises are evicted, not cached", async () => {
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

Deno.test("trailer", async (t) => {
  await t.step("initial rejection retries on the next call", async () => {
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

  await t.step("failed refresh keeps serving the stale value", async () => {
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
    // Let the last isSettled race's 1ms timer fire before the step ends, or
    // the op sanitizer reports it as a leak.
    await tick();
  });
});
