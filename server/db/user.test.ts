import { assertEquals } from "@std/assert";
import { ratingDeltaUpdate } from "./user.ts";

Deno.test("ratingDeltaUpdate escapes ids, forces DOUBLE deltas, gates on the claim", () => {
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
