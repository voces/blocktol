import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import {
  avatarColor,
  avatarColorFromHue,
  avatarHue,
  avatarInitial,
} from "./avatar.ts";

test("avatarHue is stable and in [0, 360)", () => {
  // Pinned: the hue is the wire format standings ships instead of user ids, so
  // existing colours must not shift across releases.
  assertEquals(avatarHue("00000000-0000-4000-8000-000000000000"), 228);
  assertEquals(avatarHue("test-user"), 282);
  for (const seed of ["", "a", "🙂", "some-long-user-id-value"]) {
    const hue = avatarHue(seed);
    assert(Number.isInteger(hue) && hue >= 0 && hue < 360, `hue ${hue}`);
  }
});

test("avatarColor is the hue composed into fixed-L/C OKLCH", () => {
  const seed = "test-user";
  assertEquals(avatarColor(seed), avatarColorFromHue(avatarHue(seed)));
  assertEquals(avatarColor(seed), "oklch(0.58 0.15 282)");
});

test("avatarInitial falls back to ?", () => {
  assertEquals(avatarInitial("verit"), "V");
  assertEquals(avatarInitial("  quietmoss"), "Q");
  assertEquals(avatarInitial(""), "?");
  assertEquals(avatarInitial(null), "?");
  assertEquals(avatarInitial(undefined), "?");
});
