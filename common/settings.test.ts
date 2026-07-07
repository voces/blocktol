import { assertEquals } from "@std/assert";
import { clampZoom, defaultSettings, parseSettings } from "./settings.ts";

Deno.test("parseSettings: null / non-object / bad JSON → defaults", () => {
  assertEquals(parseSettings(null), defaultSettings());
  assertEquals(parseSettings("not json"), defaultSettings());
  assertEquals(parseSettings(42), defaultSettings());
  assertEquals(parseSettings(undefined), defaultSettings());
});

Deno.test("parseSettings: reads a JSON string or a plain object", () => {
  assertEquals(parseSettings('{"theme":"dark","zoom":1.5}'), {
    theme: "dark",
    zoom: 1.5,
  });
  assertEquals(parseSettings({ theme: "light", zoom: 2 }), {
    theme: "light",
    zoom: 2,
  });
});

Deno.test("parseSettings: each invalid field falls back independently", () => {
  // Unknown theme + out-of-range zoom.
  assertEquals(parseSettings({ theme: "neon", zoom: 5 }), {
    theme: "system",
    zoom: 2.5,
  });
  // Too-low zoom clamps; missing theme defaults.
  assertEquals(parseSettings({ zoom: 0.2 }), { theme: "system", zoom: 1 });
  // Valid theme, missing zoom.
  assertEquals(parseSettings({ theme: "dark" }), { theme: "dark", zoom: 2 });
});

Deno.test("clampZoom clamps to [1, 2.5] and defaults NaN", () => {
  assertEquals(clampZoom(0), 1);
  assertEquals(clampZoom(3), 2.5);
  assertEquals(clampZoom(1.7), 1.7);
  assertEquals(clampZoom(NaN), 2);
});
