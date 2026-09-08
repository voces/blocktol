import { assertEquals, assertStringIncludes } from "@std/assert";
import { dailyEmbed, dayTopBuild } from "./dailyAnnounce.ts";
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

// ── the day's top-build post ─────────────────────────────────────────────────

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

Deno.test("dayTopBuild: the top of the BEST-BUILD board, not the ranked one", () => {
  const bests = [
    best("alice", 48.58), // won the daily on this, her ranked run
    best("saizil", 50), // matched the day's top build in free play
    best("verit", 49.73), // above the ranked winner, but holds no record
  ];
  assertEquals(dayTopBuild(bests, new Set(["alice"]), 48.58), {
    user: "saizil",
    name: "saizil",
    time: 50,
    matchers: [],
  });
});

Deno.test("dayTopBuild: the daily's winner counts like anyone else", () => {
  // The Sep 7 shape: the winner's own free play holds the top build, matched.
  const bests = [
    best("katama", 50, 100), // won the daily at 48.58, then built 50.00
    best("saizil", 50, 200),
    best("verit", 49.73),
  ];
  assertEquals(dayTopBuild(bests, new Set(["katama"]), 48.58), {
    user: "katama",
    name: "katama",
    time: 50,
    matchers: ["saizil"],
  });
});

Deno.test("dayTopBuild: the earliest holder is credited, the rest match", () => {
  const bests = [
    best("late", 50, 300),
    best("early", 50, 100),
    best(
      "mid",
      50,
      200,
    ),
  ];
  const top = dayTopBuild(bests, new Set(), 42)!;
  assertEquals(top.name, "early");
  assertEquals(top.matchers, ["mid", "late"]);
});

Deno.test("dayTopBuild: nothing to add when the winners ARE the top build", () => {
  // Equal tops mean every winner is a holder, so an equal COUNT means the same
  // people — the daily post already said this.
  assertEquals(
    dayTopBuild([best("alice", 42.1)], new Set(["alice"]), 42.1),
    null,
  );
  assertEquals(
    dayTopBuild(
      [best("alice", 42.1), best("bob", 42.1)],
      new Set(["alice", "bob"]),
      42.1,
    ),
    null,
  );
});

Deno.test("dayTopBuild: a free-play match of the winning time still posts", () => {
  const top = dayTopBuild(
    [best("alice", 42.1, 100), best("carol", 42.1, 200)],
    new Set(["alice"]),
    42.1,
  )!;
  assertEquals(top.time, 42.1);
  assertEquals(top.matchers, ["carol"]);
});

Deno.test("dayTopBuild: a nameless holder reads as anonymous", () => {
  assertEquals(
    dayTopBuild([{ user: "u", name: null, best: 42.1, at: 0 }], new Set(), 40)
      ?.name,
    "anonymous",
  );
});

Deno.test("dayTopBuild: an empty field has no record", () => {
  assertEquals(dayTopBuild([], new Set(), 42.1), null);
});

Deno.test("dailyEmbed: the summary never mentions the build board", () => {
  const d = dailyEmbed(["alice"], 42.1, day).description;
  assertEquals(d.includes("free play"), false);
  assertEquals(d.includes("top build"), false);
});
