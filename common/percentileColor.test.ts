import { assert, assertEquals, assertMatch } from "@std/assert";
import { percentileColor, readableInk } from "./percentileColor.ts";

const rgb = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// The five ramp stops land exactly at 0, .25, .5, .75, 1 (segment boundaries,
// where t = 0), so the OKLCh round-trip should reproduce each stop within a
// rounding step or two of the original hex.
const STOPS: [number, string][] = [
  [0, "#dc4a2f"],
  [0.25, "#d13d94"],
  [0.5, "#3f6be0"],
  [0.75, "#29b3a6"],
  [1, "#46b95a"],
];

for (const [p, hex] of STOPS) {
  Deno.test(`percentileColor(${p}) ≈ ${hex}`, () => {
    const got = rgb(percentileColor(p));
    const want = rgb(hex);
    for (let c = 0; c < 3; c++) {
      assert(
        Math.abs(got[c] - want[c]) <= 2,
        `channel ${c}: got ${got[c]}, want ${want[c]}`,
      );
    }
  });
}

Deno.test("percentileColor clamps out-of-range input to the endpoints", () => {
  assertEquals(percentileColor(-1), percentileColor(0));
  assertEquals(percentileColor(2), percentileColor(1));
});

Deno.test("percentileColor always returns a valid #rrggbb", () => {
  for (let p = 0; p <= 1.0001; p += 0.05) {
    assertMatch(percentileColor(p), /^#[0-9a-f]{6}$/);
  }
});

Deno.test("readableInk picks contrasting ink", () => {
  assertEquals(readableInk("#000000"), "#fff");
  assertEquals(readableInk("#ffffff"), "#1a1a1a");
});
