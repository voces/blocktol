import { useEffect, useState } from "preact/compat";
import {
  defaultSettings,
  type Language,
  parseSettings,
  type Settings,
  type SettingsPatch,
  type Theme,
} from "../../common/settings.ts";
import { setDefaultLocale } from "../../common/format.ts";
import { resolveCatalog } from "../../common/i18n.ts";
import { uiLocale } from "../util/t.ts";
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

// The last-applied settings from localStorage (flash-free), reconciled with the
// server, the cross-device source of truth, by adoptServerSettings.
let current: Settings = load();
const subscribers = new Set<(s: Settings) => void>();

// The --background token's two ends, for the status/PWA bar. It follows the
// RESOLVED theme, which prefers-color-scheme theme-color metas can't (a dark
// app on a light OS would get a light bar). Keep in step with
// `--background: light-dark(#f4f4f7, #0c0c11)`.
const BACKGROUND = { light: "#f4f4f7", dark: "#0c0c11" } as const;

// matchMedia is missing outside a browser (Node, in tests).
const prefersDark = () =>
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

// Point the theme-color meta at the resolved theme's background. "system"
// resolves against the OS now and re-syncs on OS flips (below).
const applyThemeColor = (theme: Theme) => {
  const resolved = theme === "system"
    ? (prefersDark() ? "dark" : "light")
    : theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", BACKGROUND[resolved]);
};

/**
 * Map the theme onto the root `color-scheme` (which flips the CSS
 * `light-dark()` tokens) and match the status/PWA bar to it.
 */
export const applyTheme = (theme: Theme) => {
  document.documentElement.style.colorScheme = theme === "system"
    ? "light dark"
    : theme;
  applyThemeColor(theme);
};

/**
 * Apply the UI language: point the `uiLocale` signal (read by every `t` call)
 * at the resolved tag and mirror the rendered catalog locale onto
 * `<html lang>`. "system" (or empty) follows the browser language. An
 * unsupported tag resolves to the English catalog.
 */
export const applyLanguage = (language: Language) => {
  const tag = language && language !== "system"
    ? language
    // No navigator outside a browser (Node, in tests).
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    : (globalThis.navigator?.language || "en");
  // Before the signal flips, so its re-render formats numbers in the new
  // language too.
  setDefaultLocale(tag);
  uiLocale.value = tag;
  document.documentElement.lang = resolveCatalog(tag);
};

// Re-sync the bar when the OS flips; an explicit light/dark theme ignores it.
// No matchMedia outside a browser; no MediaQueryList listeners in old Safari.
// oxlint-disable-next-line typescript/no-unnecessary-condition
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
  applyLanguage(next.language);
  for (const sub of subscribers) sub(next);
};

/**
 * Apply the cached theme and language at boot, before first paint, so there is
 * no theme flash and copy renders in the chosen language.
 */
export const initSettings = () => {
  applyTheme(current.theme);
  applyLanguage(current.language);
};

/** Non-reactive read; components should use useSettings. */
export const getSettings = () => current;

/**
 * Adopt the server's settings when the profile lands. No-op when they already
 * match what's applied, so it won't stomp a change made on this device
 * mid-flight.
 */
export const adoptServerSettings = (settings: Settings) => {
  const n = settings.notifications;
  const c = current.notifications;
  if (
    settings.theme === current.theme && settings.zoom === current.zoom &&
    settings.zoomDelay === current.zoomDelay &&
    settings.language === current.language &&
    n.lostTop === c.lostTop && n.dailyFinal === c.dailyFinal
  ) {
    return;
  }
  publish(settings);
};

// Persist to the server, debounced so a slider drag lands as one write. Sends
// the full current settings; the `setSettings` route merges.
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const schedulePersist = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void api.setSettings(current), 400);
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

  // Apply locally at once; persist to the server debounced.
  const setSettings = (patch: SettingsPatch) => {
    publish({ ...current, ...patch });
    schedulePersist();
  };

  return { settings, setSettings };
};
