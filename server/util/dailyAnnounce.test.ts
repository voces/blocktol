import { assertEquals, assertStringIncludes } from "@std/assert";
import { dailyEmbed, freePlayEmbed, freePlayReaches } from "./dailyAnnounce.ts";
import { CHARTREUSE, GOLD } from "./discordResults.ts";

const day: [number, number, number] = [2026, 7, 6];

Deno.test("dailyEmbed: a sole winner is gold", () => {
  const e = dailyEmbed(["alice"], 42.1, day);
  assertEquals(e.color, GOLD);
  assertStringIncludes(e.description, "**alice** won the daily");
  assertStringIncludes(e.description, "42.10s");
  assertStringIncludes(e.url, "20260706?board=daily");
});

Deno.test("dailyEmbed: a tie up to ten lists every winner (chartreuse)", () => {
  const winners = ["a", "b", "c"];
  const e = dailyEmbed(winners, 42.1, day);
  assertEquals(e.color, CHARTREUSE);
  assertStringIncludes(e.description, "3 players tied");
  for (const w of winners) assertStringIncludes(e.description, `• ${w}`);
});

Deno.test("dailyEmbed: exactly ten winners are still listed by name", () => {
  const winners = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const e = dailyEmbed(winners, 42.1, day);
  assertStringIncludes(e.description, "• p9");
});

Deno.test("dailyEmbed: more than ten winners collapse to a count", () => {
  const winners = Array.from({ length: 11 }, (_, i) => `p${i}`);
  const e = dailyEmbed(winners, 42.1, day);
  assertEquals(e.color, CHARTREUSE);
  assertStringIncludes(e.description, "11 players tied");
  assertEquals(e.description.includes("• p0"), false);
});

// ── the free-play companion post ─────────────────────────────────────────────

const best = (
  user: string,
  best: number,
  at = 0,
): { user: string; name: string | null; best: number; at: number } => ({
  user,
  name: user,
  best,
  at,
});

Deno.test("freePlayReaches: only non-winners at or above the winning time", () => {
  const bests = [
    best("alice", 42.1), // the winner, on her ranked run
    best("carol", 42.1), // matched it in free play
    best("dave", 43.2), // bettered it in free play
    best("erin", 41.9), // fell short
  ];
  assertEquals(
    freePlayReaches(bests, new Set(["alice"]), 42.1),
    [{ name: "dave", time: 43.2 }, { name: "carol", time: 42.1 }],
  );
});

Deno.test("freePlayReaches: equal reaches order by who got there first", () => {
  const bests = [best("late", 42.1, 200), best("early", 42.1, 100)];
  assertEquals(freePlayReaches(bests, new Set(), 42.1).map((r) => r.name), [
    "early",
    "late",
  ]);
});

Deno.test("freePlayReaches: a nameless player reads as anonymous", () => {
  const bests = [{ user: "u", name: null, best: 42.1, at: 0 }];
  assertEquals(freePlayReaches(bests, new Set(), 42.1), [{
    name: "anonymous",
    time: 42.1,
  }]);
});

Deno.test("freePlayEmbed: names matchers, times only those who bettered it", () => {
  const e = freePlayEmbed(
    [{ name: "dave", time: 43.2 }, { name: "carol", time: 42.1 }],
    42.1,
    day,
  )!;
  assertStringIncludes(
    e.description,
    "winning time of **42.10s** in free play",
  );
  assertStringIncludes(e.description, "• dave — **43.20s**");
  assertStringIncludes(e.description, "• carol\n");
  assertEquals(e.description.includes("• carol —"), false);
  // Links the best-build board, not the ranked one these builds aren't on.
  assertStringIncludes(e.url, "20260706?board=pb");
});

Deno.test("freePlayEmbed: bettering the daily's top is gold, matching it chartreuse", () => {
  assertEquals(
    freePlayEmbed([{ name: "dave", time: 43.2 }], 42.1, day)!.color,
    GOLD,
  );
  assertEquals(
    freePlayEmbed([{ name: "carol", time: 42.1 }], 42.1, day)!.color,
    CHARTREUSE,
  );
});

Deno.test("freePlayEmbed: more than ten reaches collapse to a count", () => {
  const reaches = Array.from({ length: 11 }, (_, i) => ({
    name: `p${i}`,
    time: 42.1,
  }));
  const e = freePlayEmbed(reaches, 42.1, day)!;
  assertStringIncludes(
    e.description,
    "11 players reached the daily's winning time of **42.10s** in free play.",
  );
  assertEquals(e.description.includes("• p0"), false);
});

Deno.test("freePlayEmbed: no reaches means no post at all", () => {
  assertEquals(freePlayEmbed([], 42.1, day), null);
});

Deno.test("dailyEmbed: the summary never mentions free play", () => {
  assertEquals(
    dailyEmbed(["alice"], 42.1, day).description.includes("free play"),
    false,
  );
});
