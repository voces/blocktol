import { assert, assertEquals, assertMatch } from "@std/assert";
import { randomSlug, SLUG_RE } from "./slug.ts";

Deno.test("randomSlug is 12 Crockford-base32 chars", () => {
  for (let i = 0; i < 1000; i++) {
    const slug = randomSlug();
    assertEquals(slug.length, 12);
    assertMatch(slug, SLUG_RE);
    // No ambiguous symbols (i/l/o/u) and no upper case.
    assertEquals(/[ilou]/.test(slug), false);
    assertEquals(slug, slug.toLowerCase());
  }
});

Deno.test("SLUG_RE rejects malformed slugs", () => {
  for (
    const bad of [
      "",
      "short",
      "toolongtoolong1",
      "ABCDEFGHJKMN",
      "abcdefghjkm-",
      "abcdefghjkmi", // contains ambiguous 'i'
    ]
  ) {
    assertEquals(SLUG_RE.test(bad), false);
  }
});

Deno.test("randomSlug is collision-free across a large batch", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20_000; i++) seen.add(randomSlug());
  // 60 bits of entropy — 20k draws should never collide.
  assert(seen.size === 20_000, `unexpected collision: ${seen.size}/20000`);
});
