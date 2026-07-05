import { assertEquals } from "@std/assert";
import { type IterationShape, validateRun } from "./validateRun.ts";

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
});
