import { assertEquals } from "@std/assert";
import {
  clearFreePlay,
  freePlayClientId,
  persistFreePlay,
  resumableFreePlay,
} from "./freePlay.ts";

// Deno provides a real localStorage, so these exercise the actual
// persist/resume pair. Each test starts and ends from a clean slate.

const NOW = 1_700_000_000_000;

Deno.test("free play resume: same board within the window resumes and keeps the record", () => {
  clearFreePlay();
  const id = freePlayClientId();
  persistFreePlay(7, NOW + 30_000, [
    { x: 5, y: 5 },
    { x: 6, y: 6, thunder: true },
  ]);

  const resumed = resumableFreePlay(7, NOW);
  assertEquals(resumed?.iteration, 7);
  assertEquals(resumed?.clientId, id);
  assertEquals(resumed?.blocks.length, 2);
  // The record survives a successful resume — a reload mid-build must be able
  // to resume again.
  assertEquals(resumableFreePlay(7, NOW)?.iteration, 7);

  clearFreePlay();
});

Deno.test("free play resume: staging another day skips the record but KEEPS it", () => {
  clearFreePlay();
  persistFreePlay(7, NOW + 30_000, [{ x: 5, y: 5 }]);

  // Wandering off (a day switch, a reviewed maze) doesn't abandon the build:
  // the mismatched record isn't handed to the other board...
  assertEquals(resumableFreePlay(8, NOW), null);
  // ...but it survives, so returning within the window still resumes. Only an
  // explicit reset (clearFreePlay) or the window expiring ends the attempt.
  assertEquals(resumableFreePlay(7, NOW)?.iteration, 7);

  clearFreePlay();
});

Deno.test("free play resume: an expired, empty, or reset record does not resume", () => {
  clearFreePlay();
  persistFreePlay(7, NOW - 1, [{ x: 5, y: 5 }]);
  assertEquals(resumableFreePlay(7, NOW), null);

  persistFreePlay(7, NOW + 30_000, []);
  assertEquals(resumableFreePlay(7, NOW), null);

  persistFreePlay(7, NOW + 30_000, [{ x: 5, y: 5 }]);
  clearFreePlay();
  assertEquals(resumableFreePlay(7, NOW), null);
});
