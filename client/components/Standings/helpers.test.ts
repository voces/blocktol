import { assertEquals } from "@std/assert";
import { formatAgo, formatCountdown, formatRank } from "./helpers.ts";

Deno.test("formatRank marks shared ranks with T", () => {
  assertEquals(formatRank(1, false), "1");
  assertEquals(formatRank(2, true), "T2");
  assertEquals(formatRank(211, false), "211");
});

Deno.test("formatRank approximates large ranks (PB board)", () => {
  // At the thousands, exact digits are noise and tie state is fuzzy — collapse
  // to "~N.Nk" and drop the T.
  assertEquals(formatRank(1900, false), "~1.9k");
  assertEquals(formatRank(1949, true), "~1.9k");
  assertEquals(formatRank(2000, false), "~2k");
  assertEquals(formatRank(999, false), "999");
  assertEquals(formatRank(1000, false), "~1k");
});

Deno.test("formatAgo coarsens with distance", () => {
  const now = 1_000_000_000_000;
  assertEquals(formatAgo(now - 30 * 1000, now), "now");
  assertEquals(formatAgo(now - 5 * 60_000, now), "5m ago");
  assertEquals(formatAgo(now - 19 * 3_600_000, now), "19h ago");
  assertEquals(formatAgo(now - 3 * 86_400_000, now), "3d ago");
  // A client clock behind the server must not print "-1m ago".
  assertEquals(formatAgo(now + 60_000, now), "now");
});

Deno.test("formatCountdown counts down to 'soon'", () => {
  const now = 1_000_000_000_000;
  assertEquals(
    formatCountdown(now + 9 * 3_600_000 + 41 * 60_000, now),
    "9h 41m",
  );
  assertEquals(formatCountdown(now + 41 * 60_000, now), "41m");
  // Sub-minute remains round up — never "0m" while still open.
  assertEquals(formatCountdown(now + 30_000, now), "1m");
  assertEquals(formatCountdown(now, now), "soon");
  assertEquals(formatCountdown(now - 3_600_000, now), "soon");
});
