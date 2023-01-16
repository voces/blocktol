import {
  assertNotStrictEquals,
  assertStrictEquals,
} from "std/testing/asserts.ts";
import { memoize } from "./memoize.ts";

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
