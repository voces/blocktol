import { useEffect, useState } from "preact/compat";
import {
  defaultSettings,
  parseSettings,
  Settings,
  SettingsPatch,
  Theme,
} from "../../common/settings.ts";
import { api } from "../api.ts";

const KEY = "settings";

const load = (): Settings => {
  try {
    const raw = localStorage.getItem(KEY);
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

/**
 * Map the chosen theme onto the root `color-scheme`, which flips the CSS
 * `light-dark()` tokens. "system" restores the OS-driven default.
 */
export const applyTheme = (theme: Theme) => {
  document.documentElement.style.colorScheme = theme === "system"
    ? "light dark"
    : theme;
};

const publish = (next: Settings) => {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
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
  if (settings.theme === current.theme && settings.zoom === current.zoom) {
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
