import { assertEquals } from "@std/assert";
import type { Point } from "../../common/types.ts";
import { flagWrites } from "./flagWrites.ts";

const A: Point[] = [{ x: 1, y: 1 }];
const B: Point[] = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
const C: Point[] = [{ x: 3, y: 3 }];

// A board with controllable writes: each send parks until the test settles it.
const harness = (initial: readonly Point[]) => {
  let shown = initial;
  const pending: ((ok: boolean) => void)[] = [];
  const w = flagWrites(
    () => shown,
    (_, flags) => {
      shown = flags;
    },
    () => new Promise<boolean>((resolve) => pending.push(resolve)),
  );
  return {
    w,
    shown: () => shown,
    settle: (i: number, ok: boolean) => pending[i](ok),
  };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

Deno.test("an older write failing does not roll back a newer edit", async () => {
  const h = harness(A);
  h.w.save(1, B);
  h.w.save(1, C);
  h.settle(0, false);
  await tick();
  assertEquals(h.shown(), C);
  assertEquals(h.w.saving(1), true); // the newer write is still in flight
  h.settle(1, true);
  await tick();
  assertEquals(h.shown(), C);
  assertEquals(h.w.saving(1), false);
});

Deno.test("the newest write failing rolls back to the last CONFIRMED set", async () => {
  const h = harness(A);
  h.w.save(1, B);
  h.settle(0, true);
  await tick();
  h.w.save(1, C);
  h.settle(1, false);
  await tick();
  assertEquals(h.shown(), B); // not A: B was confirmed in between
});

Deno.test("an older write landing after the newest failed is what shows", async () => {
  const h = harness(A);
  h.w.save(1, B);
  h.w.save(1, C);
  h.settle(1, false);
  await tick();
  assertEquals(h.shown(), A);
  h.settle(0, true);
  await tick();
  assertEquals(h.shown(), B);
});

Deno.test("an older success landing late can't override a newer confirmation", async () => {
  const h = harness(A);
  h.w.save(1, B);
  h.w.save(1, C);
  h.settle(1, true);
  await tick();
  h.settle(0, true);
  await tick();
  assertEquals(h.shown(), C);
});
