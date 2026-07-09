import { assertEquals } from "@std/assert";
import { Player, project } from "./standings.ts";

// A player carrying both boards' values + timestamps. Defaults keep the two
// boards' fields independent so a test can vary only what it's exercising.
const player = (over: Partial<Player> & { user: string }): Player => ({
  name: over.user,
  hue: 0,
  daily: null,
  dailyAt: 0,
  pb: 0,
  pbAt: 0,
  ...over,
});

Deno.test("PB board breaks ties by who reached the build first", () => {
  // Two identical PB builds; the earlier one (pbAt 100) must rank first even
  // though its name sorts LAST — so the ordering is by time-first, not name.
  const field = project([
    player({ user: "zed", name: "zed", pb: 42.5, pbAt: 100 }),
    player({ user: "amy", name: "amy", pb: 42.5, pbAt: 300 }),
  ], "pb");
  assertEquals(field.map((e) => e.name), ["zed", "amy"]);
});

Deno.test("PB tie-break ignores the daily time, ranks by the build's timestamp", () => {
  // The regression: the tie used to fall through to the daily time (then name),
  // which has nothing to do with who built first. `b` has the worse daily time
  // but the earlier build, so it must lead.
  const field = project([
    player({ user: "a", pb: 42.5, pbAt: 300, daily: 40 }),
    player({ user: "b", pb: 42.5, pbAt: 100, daily: 10 }),
  ], "pb");
  assertEquals(field.map((e) => e.user), ["b", "a"]);
});

Deno.test("PB tie with an equal timestamp falls back to name", () => {
  const field = project([
    player({ user: "b", name: "beta", pb: 42.5, pbAt: 100 }),
    player({ user: "a", name: "alpha", pb: 42.5, pbAt: 100 }),
  ], "pb");
  assertEquals(field.map((e) => e.name), ["alpha", "beta"]);
});

Deno.test("daily board breaks ties by who set the time first", () => {
  // The daily sort already ranked ties by dailyAt; guard it stays that way.
  const field = project([
    player({ user: "zed", name: "zed", daily: 38.5, dailyAt: 300 }),
    player({ user: "amy", name: "amy", daily: 38.5, dailyAt: 100 }),
  ], "daily");
  assertEquals(field.map((e) => e.name), ["amy", "zed"]);
});

Deno.test("daily board excludes players without a ranked run", () => {
  const field = project([
    player({ user: "ranked", daily: 30, dailyAt: 10, pb: 30, pbAt: 10 }),
    player({ user: "freeplay-only", daily: null, pb: 50, pbAt: 20 }),
  ], "daily");
  assertEquals(field.map((e) => e.user), ["ranked"]);
});
