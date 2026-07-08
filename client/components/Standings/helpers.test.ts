import { assertEquals } from "@std/assert";
import {
  formatAgo,
  formatCountdown,
  formatRank,
  formatTime,
} from "./helpers.ts";

Deno.test("formatRank marks shared ranks with T", () => {
  assertEquals(formatRank(1, false), "1");
  assertEquals(formatRank(2, true), "T2");
  assertEquals(formatRank(211, false), "211");
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

Deno.test("formatTime pins two decimals", () => {
  assertEquals(formatTime(35.1), "35.10");
  assertEquals(formatTime(30), "30.00");
  assertEquals(formatTime(29.62), "29.62");
});
