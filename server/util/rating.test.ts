import { assertAlmostEquals, assertEquals } from "@std/assert";
import { computeRatingChange, expectedPercentile, K } from "./rating.ts";

Deno.test("expectedPercentile maps rating to expected finish", () => {
  assertEquals(expectedPercentile(0), 0);
  assertEquals(expectedPercentile(1000), 0.5);
  assertEquals(expectedPercentile(2000), 0.75);
  assertEquals(expectedPercentile(3000), 0.875);
  assertAlmostEquals(expectedPercentile(415), 0.25, 0.01);
});

Deno.test("computeRatingChange: meeting expectation is no change", () => {
  // rating 1000 expects percentile 0.5; finishing at 0.5 → 0
  assertAlmostEquals(computeRatingChange(1000, 0, 0.5), 0);
});

Deno.test("computeRatingChange: over/underperforming moves symmetrically", () => {
  // plays 0 → K / log2(2) = 64; delta from expected 0.5 is ±0.5 → ±32
  assertAlmostEquals(computeRatingChange(1000, 0, 1), 32);
  assertAlmostEquals(computeRatingChange(1000, 0, 0), -32);
});

Deno.test("computeRatingChange: K-factor decays with plays", () => {
  // plays 2 → K / log2(4) = 32, so half the swing of a fresh player
  assertAlmostEquals(computeRatingChange(1000, 2, 1), 16);
  // a very experienced player barely moves
  const veteran = computeRatingChange(1000, 1022, 1); // log2(1024) = 10
  assertAlmostEquals(veteran, K / 10 * 0.5, 0.001);
});
