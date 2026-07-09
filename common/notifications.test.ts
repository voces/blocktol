import { assertEquals } from "@std/assert";
import { classifyDailyOutcome, type OutcomePlayer } from "./notifications.ts";

// Shorthand for a player row: a ranked time (or null) and a best build. When pb
// is omitted it mirrors the ranked time (no free play beyond the ranked run).
const p = (
  user: string,
  daily: number | null,
  pb?: number,
): OutcomePlayer => ({ user, daily, pb: pb ?? daily ?? 0 });

Deno.test("classifyDailyOutcome: no ranked attempt → null", () => {
  // "me" only free-played (daily null) — nothing to finalize.
  assertEquals(
    classifyDailyOutcome([p("me", null, 30), p("a", 40)], "me"),
    null,
  );
  // Not in the field at all.
  assertEquals(classifyDailyOutcome([p("a", 40)], "me"), null);
});

Deno.test("classifyDailyOutcome: placed — out-ranked", () => {
  const field = [p("a", 50), p("b", 40), p("me", 30), p("c", 20)];
  assertEquals(classifyDailyOutcome(field, "me"), {
    variant: "placed",
    rank: 3,
    players: 4,
    yourTime: 30,
    dayBest: 50,
  });
});

Deno.test("classifyDailyOutcome: placed — day best counts free play", () => {
  // "a" free-played to 60 (pb 60) though their ranked time was 45; me #2.
  const field = [p("a", 45, 60), p("me", 40), p("b", 20)];
  const out = classifyDailyOutcome(field, "me");
  assertEquals(out?.variant, "placed");
  assertEquals(out?.rank, 2);
  assertEquals(out?.dayBest, 60);
});

Deno.test("classifyDailyOutcome: supreme — sole ranked top, untied anywhere", () => {
  const field = [p("me", 50), p("a", 40), p("b", 30)];
  assertEquals(classifyDailyOutcome(field, "me"), {
    variant: "supreme",
    rank: 1,
    players: 3,
    yourTime: 50,
    dayBest: 50,
  });
});

Deno.test("classifyDailyOutcome: record — tied ranked top, no free-play beat", () => {
  // me and "a" tie at 50 ranked; nobody built higher.
  const field = [p("me", 50), p("a", 50), p("b", 30)];
  const out = classifyDailyOutcome(field, "me");
  assertEquals(out?.variant, "record");
  assertEquals(out?.rank, 1);
});

Deno.test("classifyDailyOutcome: record — sole ranked top but a build tied it", () => {
  // me sole ranked #1 at 50; "a" free-played up to exactly 50 (tie, not a beat).
  const field = [p("me", 50), p("a", 40, 50)];
  const out = classifyDailyOutcome(field, "me");
  assertEquals(out?.variant, "record");
});

Deno.test("classifyDailyOutcome: t1 — tied ranked top, free play bettered it", () => {
  // me and "a" tie at 50 ranked; "b" free-played to 55.
  const field = [p("me", 50), p("a", 50), p("b", 30, 55)];
  const out = classifyDailyOutcome(field, "me");
  assertEquals(out?.variant, "t1");
  assertEquals(out?.dayBest, 55);
  assertEquals(out?.rank, 1);
});

Deno.test("classifyDailyOutcome: first — sole ranked top, free play bettered it", () => {
  // me sole ranked #1 at 50; "a" free-played to 55.
  const field = [p("me", 50), p("a", 40, 55)];
  const out = classifyDailyOutcome(field, "me");
  assertEquals(out?.variant, "first");
  assertEquals(out?.dayBest, 55);
});

Deno.test("classifyDailyOutcome: your own free play doesn't demote your record", () => {
  // me ranked 50, then free-played to 60; nobody else near. Still supreme —
  // the beat must come from ANOTHER player.
  const field = [p("me", 50, 60), p("a", 30)];
  const out = classifyDailyOutcome(field, "me");
  assertEquals(out?.variant, "supreme");
  assertEquals(out?.dayBest, 60);
});

Deno.test("classifyDailyOutcome: solo ranked player → supreme #1 of 1", () => {
  assertEquals(classifyDailyOutcome([p("me", 42)], "me"), {
    variant: "supreme",
    rank: 1,
    players: 1,
    yourTime: 42,
    dayBest: 42,
  });
});
