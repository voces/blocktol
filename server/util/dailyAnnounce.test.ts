import { assertEquals, assertStringIncludes } from "@std/assert";
import { dailyEmbed } from "./dailyAnnounce.ts";
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
  assertEquals(e.description.includes("a record"), false);
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
