import { assertEquals } from "@std/assert";
import { computeVerdict, scorePercent } from "./verdict.ts";

Deno.test("scorePercent maps time into [min, best]", () => {
  // Halfway between the floor and the field best.
  assertEquals(scorePercent(20, 10, 30), 0.5);
  // Beating the field best reads over 1 (a supreme).
  assertEquals(scorePercent(40, 10, 30), 1.5);
  // Degenerate empty field (best === min): any real run is the top.
  assertEquals(scorePercent(15, 10, 10), 1);
  assertEquals(scorePercent(10, 10, 10), 0);
});

Deno.test("computeVerdict: no milestone returns null", () => {
  // Below your own best (25) and the field best (30) — nothing to celebrate.
  assertEquals(computeVerdict(22, 10, 30, 25), null);
});

Deno.test("computeVerdict: a personal best that stays under the field", () => {
  // Beat your own 25 but not the field's 30.
  const v = computeVerdict(28, 10, 30, 25);
  assertEquals(v?.outcome, "pb");
  assertEquals(v?.time, 28);
});

Deno.test("computeVerdict: first-ever run is a PB only with a prior best", () => {
  // No prior personal best (null) and short of the field → not a milestone.
  assertEquals(computeVerdict(28, 10, 30, null), null);
});

Deno.test("computeVerdict: tying the field best is a record", () => {
  const v = computeVerdict(30, 10, 30, 25);
  assertEquals(v?.outcome, "record");
  assertEquals(v?.percent, 1);
});

Deno.test("computeVerdict: beating the field best is supreme", () => {
  const v = computeVerdict(33, 10, 30, 25);
  assertEquals(v?.outcome, "supreme");
  // Reads over 100% — the field best was the pre-run bar.
  assertEquals(v!.percent > 1, true);
});

Deno.test("computeVerdict: supreme outranks record and PB", () => {
  // A run that beats the field is also a PB, but supreme wins.
  assertEquals(computeVerdict(40, 10, 30, 25)?.outcome, "supreme");
});
