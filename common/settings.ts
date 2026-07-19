// User preferences, persisted server-side as a JSON blob in `user.settings` and
// mirrored to localStorage on the client for instant (flash-free) apply. Kept
// dependency-free (no zod) so the client bundle stays small — the server route
// does its own zod validation of incoming patches; this module is the tolerant
// reader shared by both sides.

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

// Board magnification when placing (touch). 1× disables the zoom entirely.
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;
export const ZOOM_DEFAULT = 2;

// Delay (ms) before the placing zoom kicks in on a touch. 0 (the default) keeps
// the old behaviour — zoom the instant a finger lands. A larger value lets a
// quick tap-to-place finish before the board magnifies, so a plain tap never
// triggers the (disorienting) zoom-in/zoom-out.
export const ZOOM_DELAY_MIN = 0;
export const ZOOM_DELAY_MAX = 500;
export const ZOOM_DELAY_DEFAULT = 0;

// The user-toggleable PUSH notification kinds (see common/notifications.ts).
// These gate PUSH delivery ONLY — in-app notifications are always generated
// regardless. Each is opted OUT by default (explicit opt-in), since turning one
// on prompts the browser for notification permission. The server reads them
// before sending a push, never before writing the in-app row.
export type NotificationPrefs = { lostTop: boolean; dailyFinal: boolean };

// UI language. "system" follows the device/browser language (falling back to
// English for an unsupported one); any other value is a BCP-47 tag the catalog
// resolves (exact → language-prefix → en, see common/i18n resolveCatalog). Kept
// as a plain string — the picker only offers supported locales, and the runtime
// tolerates anything, so no locale enum has to be imported here.
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

// A boolean field, tolerant of a legacy/absent/garbage value: only a real
// `false` turns a default-on preference off.
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
 * Parse a stored settings blob (a JSON string, an object, or null) into full
 * Settings, filling any missing or invalid field with its default rather than
 * throwing — so legacy rows, a schema change, or a corrupt blob are always safe.
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
    // Tolerant: any string rides through (the catalog resolves an unsupported
    // tag to English); anything else is the follow-the-device default.
    language: typeof src.language === "string" ? src.language : "system",
    notifications: parseNotifications(src.notifications),
  };
};
