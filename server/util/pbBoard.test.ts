import { assertEquals, assertStringIncludes } from "@std/assert";
import { decidePbAnnouncement, pbEmbed } from "./pbBoard.ts";
import { CHARTREUSE, GOLD } from "./discordResults.ts";

const day: [number, number, number] = [2026, 7, 6];

Deno.test("decidePbAnnouncement: first record of the day posts", () => {
  assertEquals(decidePbAnnouncement(30.5, "alice", 1, null), "post");
});

Deno.test("decidePbAnnouncement: a new leader taking a higher top posts", () => {
  assertEquals(
    decidePbAnnouncement(35, "bob", 1, {
      topTime: 30.5,
      topUser: "alice",
      holders: 1,
    }),
    "post",
  );
});

Deno.test("decidePbAnnouncement: the same leader improving their top edits (no spam)", () => {
  assertEquals(
    decidePbAnnouncement(35, "alice", 1, {
      topTime: 30.5,
      topUser: "alice",
      holders: 1,
    }),
    "edit",
  );
});

Deno.test("decidePbAnnouncement: a newly-matched top edits the tie count", () => {
  assertEquals(
    decidePbAnnouncement(30.5, "alice", 2, {
      topTime: 30.5,
      topUser: "alice",
      holders: 1,
    }),
    "edit",
  );
});

Deno.test("decidePbAnnouncement: the same top and holder count is a no-op", () => {
  assertEquals(
    decidePbAnnouncement(30.5, "alice", 1, {
      topTime: 30.5,
      topUser: "alice",
      holders: 1,
    }),
    "none",
  );
});

Deno.test("decidePbAnnouncement: a lower top (can't happen) is a no-op", () => {
  assertEquals(
    decidePbAnnouncement(28, "alice", 1, {
      topTime: 30.5,
      topUser: "alice",
      holders: 1,
    }),
    "none",
  );
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
