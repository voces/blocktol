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
    notifications: notifs(),
  });
  assertEquals(parseSettings({ theme: "light", zoom: 2 }), {
    theme: "light",
    zoom: 2,
    notifications: notifs(),
  });
});

Deno.test("parseSettings: each invalid field falls back independently", () => {
  // Unknown theme + out-of-range zoom.
  assertEquals(parseSettings({ theme: "neon", zoom: 5 }), {
    theme: "system",
    zoom: 2.5,
    notifications: notifs(),
  });
  // Too-low zoom clamps; missing theme defaults.
  assertEquals(parseSettings({ zoom: 0.2 }), {
    theme: "system",
    zoom: 1,
    notifications: notifs(),
  });
  // Valid theme, missing zoom.
  assertEquals(parseSettings({ theme: "dark" }), {
    theme: "dark",
    zoom: 2,
    notifications: notifs(),
  });
});

Deno.test("parseSettings: notification prefs default on; only false opts out", () => {
  // Absent / garbage → both on.
  assertEquals(parseSettings({}).notifications, {
    lostTop: true,
    dailyFinal: true,
  });
  assertEquals(parseSettings({ notifications: "nope" }).notifications, {
    lostTop: true,
    dailyFinal: true,
  });
  // Each toggle is independent, and only a real `false` turns one off.
  assertEquals(
    parseSettings({ notifications: { lostTop: false } }).notifications,
    { lostTop: false, dailyFinal: true },
  );
  assertEquals(
    parseSettings({ notifications: { lostTop: 0, dailyFinal: false } })
      .notifications,
    { lostTop: true, dailyFinal: false },
  );
});

Deno.test("clampZoom clamps to [1, 2.5] and defaults NaN", () => {
  assertEquals(clampZoom(0), 1);
  assertEquals(clampZoom(3), 2.5);
  assertEquals(clampZoom(1.7), 1.7);
  assertEquals(clampZoom(NaN), 2);
});
