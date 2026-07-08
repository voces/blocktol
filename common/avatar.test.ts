import { assert, assertEquals } from "@std/assert";
import {
  avatarColor,
  avatarColorFromHue,
  avatarHue,
  avatarInitial,
} from "./avatar.ts";

Deno.test("avatarHue is stable and in [0, 360)", () => {
  // Pinned values: the hue doubles as the wire format standings ships in place
  // of user ids, and existing users' colours must not shift across releases.
  assertEquals(avatarHue("00000000-0000-4000-8000-000000000000"), 228);
  assertEquals(avatarHue("test-user"), 282);
  for (const seed of ["", "a", "🙂", "some-long-user-id-value"]) {
    const hue = avatarHue(seed);
    assert(Number.isInteger(hue) && hue >= 0 && hue < 360, `hue ${hue}`);
  }
});

Deno.test("avatarColor is the hue composed into fixed-L/C OKLCH", () => {
  const seed = "test-user";
  assertEquals(avatarColor(seed), avatarColorFromHue(avatarHue(seed)));
  assertEquals(avatarColor(seed), "oklch(0.58 0.15 282)");
});

Deno.test("avatarInitial falls back to ?", () => {
  assertEquals(avatarInitial("verit"), "V");
  assertEquals(avatarInitial("  quietmoss"), "Q");
  assertEquals(avatarInitial(""), "?");
  assertEquals(avatarInitial(null), "?");
  assertEquals(avatarInitial(undefined), "?");
});
