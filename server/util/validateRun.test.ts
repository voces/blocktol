import { assertEquals } from "@std/assert";
import {
  type IterationShape,
  type RunValidation,
  validateRun,
} from "./validateRun.ts";

// Checkpoints are half-integer cells (see newIteration); an empty maze here has
// a path, so it exercises the legal branch.
const iteration: IterationShape = {
  bricks: 3,
  power: 1,
  checkpoint: { x: 9.5, y: 9.5 },
  blocks: [],
};

Deno.test("validateRun", async (t) => {
  await t.step("a legal placement returns its computed duration", () => {
    const r = validateRun(iteration, [{ x: 5, y: 5 }]);
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.duration > 0, true);
  });

  await t.step("more blocks than bricks is rejected", () => {
    const r = validateRun(iteration, [
      { x: 2, y: 2 },
      { x: 4, y: 4 },
      { x: 6, y: 6 },
      { x: 8, y: 8 },
    ]);
    assertEquals(r, { ok: false, reason: "too many blocks" });
  });

  await t.step("more thunders than power is rejected", () => {
    const r = validateRun(iteration, [
      { x: 2, y: 2, thunder: true },
      { x: 4, y: 4, thunder: true },
    ]);
    assertEquals(r, { ok: false, reason: "too many slows" });
  });

  await t.step("overlapping pieces are an invalid path", () => {
    const r = validateRun(iteration, [{ x: 5, y: 5 }, { x: 5, y: 5 }]);
    assertEquals(r, { ok: false, reason: "invalid path" });
  });

  // A day with a fixed block at (4,4), to place pieces against.
  const withBlock: IterationShape = {
    ...iteration,
    bricks: 5,
    blocks: [{ x: 4, y: 4 }],
  };
  const invalid: RunValidation = { ok: false, reason: "invalid path" };

  await t.step("the placeable range's edges are legal", () => {
    for (const p of [{ x: 1, y: 1 }, { x: 17, y: 17 }, { x: 1, y: 17 }]) {
      assertEquals(validateRun(withBlock, [p]).ok, true, JSON.stringify(p));
    }
  });

  // Fractional / off-grid coordinates read `undefined` (free) in the solver's
  // grid, so each of these used to validate.
  await t.step("a fractional piece is an invalid path", () => {
    // Half over the fixed block at (4,4).
    assertEquals(validateRun(withBlock, [{ x: 4.5, y: 4 }]), invalid);
    // Half inside the left border.
    assertEquals(validateRun(withBlock, [{ x: 0.5, y: 10 }]), invalid);
  });

  await t.step("an off-board piece is an invalid path", () => {
    for (
      const p of [
        { x: 50, y: 5 },
        { x: 0, y: 5 },
        { x: 18, y: 5 },
        { x: 5, y: 0 },
        { x: 5, y: 18 },
        { x: -1, y: 5 },
        { x: NaN, y: 5 },
        { x: Infinity, y: 5 },
      ]
    ) assertEquals(validateRun(withBlock, [p]), invalid, JSON.stringify(p));
  });

  await t.step("overlapping fractional pieces are an invalid path", () => {
    assertEquals(
      validateRun(withBlock, [{ x: 6.5, y: 3 }, { x: 6.6, y: 3 }]),
      invalid,
    );
  });

  await t.step("a duplicate piece is an invalid path", () => {
    assertEquals(
      validateRun(withBlock, [{ x: 8, y: 8 }, { x: 8, y: 8, thunder: true }]),
      invalid,
    );
  });

  await t.step("a piece on or overlapping a fixed block is invalid", () => {
    for (const p of [{ x: 4, y: 4 }, { x: 3, y: 3 }, { x: 5, y: 4 }]) {
      assertEquals(validateRun(withBlock, [p]), invalid, JSON.stringify(p));
    }
  });

  await t.step("a piece over the checkpoint cell is invalid", () => {
    // Checkpoint 9.5,9.5 holds cell (10,10); any footprint covering it.
    for (const p of [{ x: 9, y: 9 }, { x: 10, y: 10 }, { x: 10, y: 9 }]) {
      assertEquals(validateRun(withBlock, [p]), invalid, JSON.stringify(p));
    }
  });

  // Start (9,19) and end (10,0) sit in the border ring's gaps (rows 19 and 0),
  // which the 1..17 anchor range can't reach; the nearest legal piece seals the
  // gap from inside, which leaves no route.
  await t.step("sealing the start or end gap is invalid", () => {
    assertEquals(validateRun(withBlock, [{ x: 9, y: 1 }]), invalid);
    assertEquals(validateRun(withBlock, [{ x: 9, y: 17 }]), invalid);
  });
});
