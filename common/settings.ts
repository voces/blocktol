// User preferences: a JSON blob in `user.settings`, mirrored to localStorage on
// the client for flash-free apply. Dependency-free (no zod) to keep the client
// bundle small; the server route validates incoming patches itself, and this
// module is the tolerant reader both sides share.

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

// Board magnification when placing (touch). 1× disables the zoom entirely.
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;
export const ZOOM_DEFAULT = 2;

// Delay (ms) before the placing zoom kicks in on a touch. The default lets a
// quick tap-to-place finish first, so a plain tap never zooms; 0 zooms as soon
// as a finger lands.
export const ZOOM_DELAY_MIN = 0;
export const ZOOM_DELAY_MAX = 500;
export const ZOOM_DELAY_DEFAULT = 175;

// The user-toggleable PUSH notification kinds (see common/notifications.ts).
// They gate PUSH delivery ONLY; in-app notifications are always written. Each
// defaults off, since turning one on prompts for browser notification
// permission.
export type NotificationPrefs = { lostTop: boolean; dailyFinal: boolean };

// UI language. "system" follows the device language (English if unsupported);
// any other value is a BCP-47 tag resolved by `resolveCatalog` in
// common/i18n.ts (exact → language prefix → en). A plain string, so no locale
// enum is imported.
export type Language = "system" | string;

export type Settings = {
  theme: Theme;
  zoom: number;
  zoomDelay: number;
  language: Language;
  notifications: NotificationPrefs;
};
export type SettingsPatch = Partial<Settings>;

export const clampZoom = (n: number) =>
  Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : ZOOM_DEFAULT;

export const clampZoomDelay = (n: number) =>
  Number.isFinite(n)
    ? Math.min(ZOOM_DELAY_MAX, Math.max(ZOOM_DELAY_MIN, n))
    : ZOOM_DELAY_DEFAULT;

export const defaultNotificationPrefs = (): NotificationPrefs => ({
  lostTop: false,
  dailyFinal: false,
});

export const defaultSettings = (): Settings => ({
  theme: "system",
  zoom: ZOOM_DEFAULT,
  zoomDelay: ZOOM_DELAY_DEFAULT,
  language: "system",
  notifications: defaultNotificationPrefs(),
});

// A boolean field, tolerant of a legacy, absent or garbage value: anything but
// a real boolean falls back to the default.
const bool = (v: unknown, fallback: boolean) =>
  typeof v === "boolean" ? v : fallback;

const parseNotifications = (raw: unknown): NotificationPrefs => {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const d = defaultNotificationPrefs();
  return {
    lostTop: bool(src.lostTop, d.lostTop),
    dailyFinal: bool(src.dailyFinal, d.dailyFinal),
  };
};

/**
 * Parse a stored settings blob (JSON string, object or null) into full
 * Settings, defaulting any missing or invalid field instead of throwing.
 */
export const parseSettings = (raw: unknown): Settings => {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = undefined;
    }
  }
  const src = (obj && typeof obj === "object" ? obj : {}) as Record<
    string,
    unknown
  >;
  return {
    theme: (themes as readonly string[]).includes(src.theme as string)
      ? (src.theme as Theme)
      : "system",
    zoom: clampZoom(Number(src.zoom)),
    zoomDelay: clampZoomDelay(Number(src.zoomDelay)),
    // Any string passes; the catalog resolves an unsupported tag to English.
    language: typeof src.language === "string" ? src.language : "system",
    notifications: parseNotifications(src.notifications),
  };
};
