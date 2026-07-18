import { assertEquals } from "@std/assert";
import {
  clampZoom,
  defaultNotificationPrefs,
  defaultSettings,
  parseSettings,
} from "./settings.ts";

// The notification prefs default on; most cases below don't exercise them, so a
// helper keeps the expected objects readable.
const notifs = defaultNotificationPrefs;

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
    language: "system",
    notifications: notifs(),
  });
  assertEquals(parseSettings({ theme: "light", zoom: 2 }), {
    theme: "light",
    zoom: 2,
    language: "system",
    notifications: notifs(),
  });
});

Deno.test("parseSettings: language rides through as a string, else system", () => {
  // Any string is kept (the catalog resolves an unsupported tag to English).
  assertEquals(parseSettings({ language: "fr" }).language, "fr");
  assertEquals(parseSettings({ language: "zh-Hans" }).language, "zh-Hans");
  assertEquals(parseSettings({ language: "system" }).language, "system");
  // Absent or non-string → the follow-the-device default.
  assertEquals(parseSettings({}).language, "system");
  assertEquals(parseSettings({ language: 5 }).language, "system");
});

Deno.test("parseSettings: each invalid field falls back independently", () => {
  // Unknown theme + out-of-range zoom.
  assertEquals(parseSettings({ theme: "neon", zoom: 5 }), {
    theme: "system",
    zoom: 2.5,
    language: "system",
    notifications: notifs(),
  });
  // Too-low zoom clamps; missing theme defaults.
  assertEquals(parseSettings({ zoom: 0.2 }), {
    theme: "system",
    zoom: 1,
    language: "system",
    notifications: notifs(),
  });
  // Valid theme, missing zoom.
  assertEquals(parseSettings({ theme: "dark" }), {
    theme: "dark",
    zoom: 2,
    language: "system",
    notifications: notifs(),
  });
});

Deno.test("parseSettings: push prefs default off; only true opts in", () => {
  // Absent / garbage → both off (explicit opt-in).
  assertEquals(parseSettings({}).notifications, {
    lostTop: false,
    dailyFinal: false,
  });
  assertEquals(parseSettings({ notifications: "nope" }).notifications, {
    lostTop: false,
    dailyFinal: false,
  });
  // Each toggle is independent, and only a real `true` turns one on.
  assertEquals(
    parseSettings({ notifications: { lostTop: true } }).notifications,
    { lostTop: true, dailyFinal: false },
  );
  assertEquals(
    parseSettings({ notifications: { lostTop: 1, dailyFinal: true } })
      .notifications,
    { lostTop: false, dailyFinal: true },
  );
});

Deno.test("clampZoom clamps to [1, 2.5] and defaults NaN", () => {
  assertEquals(clampZoom(0), 1);
  assertEquals(clampZoom(3), 2.5);
  assertEquals(clampZoom(1.7), 1.7);
  assertEquals(clampZoom(NaN), 2);
});
