import { useEffect, useState } from "preact/compat";
import {
  defaultSettings,
  parseSettings,
  Settings,
  SettingsPatch,
  Theme,
} from "../../common/settings.ts";
import { api } from "../api.ts";
import { storage } from "../util/storage.ts";

const KEY = "settings";

const load = (): Settings => {
  try {
    const raw = storage.getItem(KEY);
    return raw ? parseSettings(raw) : defaultSettings();
  } catch {
    return defaultSettings();
  }
};

// Instant, flash-free source: the last-applied settings from localStorage,
// reconciled with the server (see adoptServerSettings) once the profile lands —
// the server is the cross-device source of truth.
let current: Settings = load();
const subscribers = new Set<(s: Settings) => void>();

// The --background token's two ends. The status/PWA bar rides whichever the
// RESOLVED theme shows, so it can't diverge from the app the way the old
// prefers-color-scheme theme-color metas did (a dark app on a light OS showed a
// light bar). Kept in step with `--background: light-dark(#f4f4f7, #0c0c11)`.
const BACKGROUND = { light: "#f4f4f7", dark: "#0c0c11" } as const;

const prefersDark = () =>
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

// Point the single theme-color meta at the resolved theme's background —
// "system" resolves against the OS right now (and re-syncs on OS flips below).
const applyThemeColor = (theme: Theme) => {
  const resolved = theme === "system"
    ? (prefersDark() ? "dark" : "light")
    : theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", BACKGROUND[resolved]);
};

/**
 * Map the chosen theme onto the root `color-scheme`, which flips the CSS
 * `light-dark()` tokens, and match the status/PWA bar to it. "system" restores
 * the OS-driven default.
 */
export const applyTheme = (theme: Theme) => {
  document.documentElement.style.colorScheme = theme === "system"
    ? "light dark"
    : theme;
  applyThemeColor(theme);
};

// In "system" mode the bar follows the OS live, so re-sync when the OS flips
// (an explicit light/dark bar is pinned and ignores this).
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.(
  "change",
  () => {
    if (current.theme === "system") applyThemeColor("system");
  },
);

const publish = (next: Settings) => {
  current = next;
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch { /* private mode / disabled storage */ }
  applyTheme(next.theme);
  for (const sub of subscribers) sub(next);
};

/** Apply the cached theme as early as possible (boot), before first paint. */
export const initSettings = () => applyTheme(current.theme);

/** Non-reactive read (e.g. one-off lookups). Components should use useSettings. */
export const getSettings = () => current;

/**
 * Adopt the server's settings when the profile lands — the cross-device source
 * of truth. No-op when they already match what's applied, so it won't stomp a
 * change the user just made on this device mid-flight.
 */
export const adoptServerSettings = (settings: Settings) => {
  const n = settings.notifications;
  const c = current.notifications;
  if (
    settings.theme === current.theme && settings.zoom === current.zoom &&
    n.lostTop === c.lostTop && n.dailyFinal === c.dailyFinal
  ) {
    return;
  }
  publish(settings);
};

// Persist to the server, debounced so a slider drag (many rapid changes) lands
// as a single write once it settles. Sends the full current settings — the
// route merges, so sending both fields is harmless.
let persistTimer = -1;
const schedulePersist = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => api.setSettings(current), 400);
};

export const useSettings = () => {
  const [settings, setLocal] = useState(current);

  useEffect(() => {
    setLocal(current);
    subscribers.add(setLocal);
    return () => {
      subscribers.delete(setLocal);
    };
  }, []);

  // Apply locally right away (flash-free), persist to the server debounced.
  const setSettings = (patch: SettingsPatch) => {
    publish({ ...current, ...patch });
    schedulePersist();
  };

  return { settings, setSettings };
};
