import { assertEquals, assertStringIncludes } from "@std/assert";
import { decidePbAction, pbEmbed, topPbToAnnounce } from "./pbBoard.ts";
import { type BestRow } from "./lostTop.ts";
import { CHARTREUSE, GOLD } from "./discordResults.ts";

const day: [number, number, number] = [2026, 7, 6];

const rows = (...pairs: [string, number][]): BestRow[] =>
  pairs.map(([user, best]) => ({ user, name: user, best }));

// A marker crediting "me" at 30 with a sole holder, unless overridden.
const mk = (
  over: Partial<{ topUser: string; topTime: number; holders: number }> = {},
) => ({
  topUser: "me",
  topTime: 30,
  holders: 1,
  ...over,
});

// ── topPbToAnnounce (replay-safe new-sole-top detection) ─────────────────────

Deno.test("topPbToAnnounce: passing the previous holder announces the passer", () => {
  assertEquals(topPbToAnnounce(rows(["me", 55], ["a", 50]), "me", 30), {
    name: "me",
    time: 55,
  });
});

Deno.test("topPbToAnnounce: the day's first PB (sole player) announces", () => {
  assertEquals(topPbToAnnounce(rows(["me", 40]), "me", null), {
    name: "me",
    time: 40,
  });
});

Deno.test("topPbToAnnounce: a non-topping build, a tie, and an extended lead announce nothing", () => {
  assertEquals(topPbToAnnounce(rows(["me", 45], ["a", 50]), "me", 20), null);
  assertEquals(topPbToAnnounce(rows(["me", 50], ["a", 50]), "me", 30), null);
  assertEquals(topPbToAnnounce(rows(["me", 70], ["a", 50]), "me", 60), null);
});

// ── decidePbAction (post / edit / none) ──────────────────────────────────────
// args: (isTop, me, count, newHolder, marker, actor, stale)

Deno.test("decidePbAction: a new holder posts", () => {
  assertEquals(
    decidePbAction(true, 55, 1, true, mk({ topUser: "a" }), "me", false),
    "post",
  );
  assertEquals(decidePbAction(true, 40, 1, true, null, "me", false), "post");
});

Deno.test("decidePbAction: a non-topping build with no prior record does nothing", () => {
  assertEquals(decidePbAction(false, 45, 1, false, null, "me", false), "none");
});

Deno.test("decidePbAction: the same holder improving within the window (still sole) edits", () => {
  assertEquals(decidePbAction(true, 35, 1, false, mk(), "me", false), "edit");
});

Deno.test("decidePbAction: the same holder improving past the window posts anew", () => {
  assertEquals(decidePbAction(true, 35, 1, false, mk(), "me", true), "post");
});

Deno.test("decidePbAction: the same holder improving after a match posts anew (breaks the seal)", () => {
  // held supreme → someone matched (holders 2) → improve, retaking supreme → post.
  assertEquals(
    decidePbAction(true, 35, 1, false, mk({ holders: 2 }), "me", false),
    "post",
  );
});

Deno.test("decidePbAction: a build matching the announced top edits the tie count", () => {
  // "me" ties "a"'s announced top of 30; now two share it.
  assertEquals(
    decidePbAction(true, 30, 2, false, mk({ topUser: "a" }), "me", false),
    "edit",
  );
});

Deno.test("decidePbAction: matching an already-counted tie does nothing", () => {
  assertEquals(
    decidePbAction(
      true,
      30,
      2,
      false,
      mk({ topUser: "a", holders: 2 }),
      "me",
      false,
    ),
    "none",
  );
});

Deno.test("decidePbAction: the same holder not improving does nothing", () => {
  assertEquals(decidePbAction(true, 30, 1, false, mk(), "me", false), "none");
});

Deno.test("decidePbAction: the announced holder who got passed does nothing", () => {
  assertEquals(decidePbAction(false, 30, 1, false, mk(), "me", false), "none");
});

// ── pbEmbed ──────────────────────────────────────────────────────────────────

Deno.test("pbEmbed: a sole holder is gold, no tally", () => {
  const e = pbEmbed("alice", 30.5, 1, day);
  assertEquals(e.color, GOLD);
  assertEquals(e.title, "Top PB: Jul 6");
  assertStringIncludes(
    e.description,
    "**alice** set the top build of Jul 6 at **30.50s**.",
  );
  assertEquals(e.description.includes("matched"), false);
  assertStringIncludes(e.url, "20260706?board=pb");
});

Deno.test("pbEmbed: a matched top is chartreuse with the tie count", () => {
  const two = pbEmbed("alice", 30.5, 2, day);
  assertEquals(two.color, CHARTREUSE);
  assertStringIncludes(two.description, "1 player has matched it.");

  const four = pbEmbed("alice", 30.5, 4, day);
  assertStringIncludes(four.description, "3 players have matched it.");
});
