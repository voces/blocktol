import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { mergeRivals, ratingDeltaUpdate } from "./user.ts";

test("ratingDeltaUpdate escapes ids, forces DOUBLE deltas, gates on the claim", () => {
  const q = ratingDeltaUpdate([
    { user: "a'b", delta: 1.5e-7 },
    { user: "c", delta: -12.25 },
  ]).replace(/\s+/g, " ");
  assertEquals(
    q,
    "UPDATE user SET rating = GREATEST(0, rating + CASE id " +
      "WHEN 'a\\'b' THEN 1.5e-7 + 0e0 WHEN 'c' THEN -12.25 + 0e0 END), " +
      "plays = plays + 1 WHERE @claimed > 0 AND id IN ('a\\'b', 'c');",
  );
});

test("mergeRivals keeps rivals with 5+ meetings on either board, most-met first", () => {
  const row = (user: string, met: number, won = 0) => ({
    user,
    name: user,
    met,
    won,
    lost: met - won,
    tied: 0,
  });
  const merged = mergeRivals(
    [row("a", 5, 3), row("b", 4), row("c", 9)],
    [row("b", 6, 6), row("d", 2)],
  );
  assertEquals(merged.map((r) => r.name), ["c", "a", "b"]);
  assertEquals(merged[1].daily, { met: 5, won: 3, lost: 2, tied: 0 });
  assertEquals(merged[1].pb, null);
  // Under the minimum on the daily board, so only its PB record shows.
  assertEquals(merged[2].daily, null);
  assertEquals(merged[2].pb, { met: 6, won: 6, lost: 0, tied: 0 });
});
