import { assertEquals, assertStringIncludes } from "@std/assert";
import { pbEmbed, topPbToAnnounce } from "./pbBoard.ts";
import { type BestRow } from "./lostTop.ts";
import { GOLD } from "./discordResults.ts";

const day: [number, number, number] = [2026, 7, 6];

const rows = (...pairs: [string, number][]): BestRow[] =>
  pairs.map(([user, best]) => ({ user, name: user, best }));

Deno.test("topPbToAnnounce: passing the previous holder announces the passer", () => {
  const t = topPbToAnnounce(rows(["me", 55], ["a", 50]), "me", 30);
  assertEquals(t, { name: "me", time: 55 });
});

Deno.test("topPbToAnnounce: the day's first PB (sole player) announces", () => {
  assertEquals(topPbToAnnounce(rows(["me", 40]), "me", null), {
    name: "me",
    time: 40,
  });
});

Deno.test("topPbToAnnounce: a non-topping build announces nothing", () => {
  // The replay bug: a build below the top must not surface the standing record.
  assertEquals(topPbToAnnounce(rows(["me", 45], ["a", 50]), "me", 20), null);
});

Deno.test("topPbToAnnounce: a tie announces nothing", () => {
  assertEquals(topPbToAnnounce(rows(["me", 50], ["a", 50]), "me", 30), null);
});

Deno.test("topPbToAnnounce: extending your own lead announces nothing", () => {
  assertEquals(topPbToAnnounce(rows(["me", 70], ["a", 50]), "me", 60), null);
});

Deno.test("topPbToAnnounce: a sole player's non-improving replay announces nothing", () => {
  // me already at 40 (prev 40); a worse/equal build doesn't better their own best.
  assertEquals(topPbToAnnounce(rows(["me", 40]), "me", 40), null);
});

Deno.test("pbEmbed: gold, names the setter, links the day", () => {
  const e = pbEmbed("alice", 30.5, day);
  assertEquals(e.color, GOLD);
  assertEquals(e.title, "Top PB: Jul 6");
  assertStringIncludes(
    e.description,
    "**alice** set the top build of Jul 6 at **30.50s**.",
  );
  assertStringIncludes(e.url, "20260706?board=pb");
});
