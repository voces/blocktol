import { assertEquals, assertStringIncludes } from "@std/assert";
import { decidePbAnnouncement, pbEmbed } from "./pbBoard.ts";
import { CHARTREUSE, GOLD } from "./discordResults.ts";

const day: [number, number, number] = [2026, 7, 6];

const stored = (
  over: Partial<{ topTime: number; topUser: string; holders: number }> = {},
) => ({
  topTime: 30.5,
  topUser: "alice",
  holders: 1,
  ...over,
});

Deno.test("decidePbAnnouncement: first record of the day posts", () => {
  assertEquals(decidePbAnnouncement(30.5, "alice", 1, null, false), "post");
});

Deno.test("decidePbAnnouncement: a new leader taking a higher top posts", () => {
  assertEquals(decidePbAnnouncement(35, "bob", 1, stored(), false), "post");
});

Deno.test("decidePbAnnouncement: the same leader improving within the window edits (no spam)", () => {
  assertEquals(decidePbAnnouncement(35, "alice", 1, stored(), false), "edit");
});

Deno.test("decidePbAnnouncement: the same leader improving after the window posts anew", () => {
  // A return visit hours later (sameHolderStale) earns its own message.
  assertEquals(decidePbAnnouncement(35, "alice", 1, stored(), true), "post");
});

Deno.test("decidePbAnnouncement: a matched top edits the tie count even when stale", () => {
  // The staleness gate is only for a same-holder IMPROVEMENT; a fresh match still
  // edits the standing post's tie count.
  assertEquals(decidePbAnnouncement(30.5, "alice", 2, stored(), true), "edit");
});

Deno.test("decidePbAnnouncement: the same top and holder count is a no-op", () => {
  assertEquals(decidePbAnnouncement(30.5, "alice", 1, stored(), false), "none");
});

Deno.test("decidePbAnnouncement: a lower top (can't happen) is a no-op", () => {
  assertEquals(decidePbAnnouncement(28, "alice", 1, stored(), false), "none");
});

Deno.test("pbEmbed: a sole holder is gold and names the setter", () => {
  const e = pbEmbed("alice", 30.5, 1, day);
  assertEquals(e.color, GOLD);
  assertStringIncludes(e.description, "**alice**");
  assertStringIncludes(e.description, "30.50s");
  assertStringIncludes(e.url, "20260706?board=pb");
});

Deno.test("pbEmbed: a matched record is chartreuse with the tie count", () => {
  const two = pbEmbed("alice", 30.5, 2, day);
  assertEquals(two.color, CHARTREUSE);
  assertStringIncludes(two.description, "matched by 1 player");

  const four = pbEmbed("alice", 30.5, 4, day);
  assertStringIncludes(four.description, "matched by 3 players");
});
