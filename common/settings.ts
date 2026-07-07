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

export type Settings = { theme: Theme; zoom: number };
export type SettingsPatch = Partial<Settings>;

export const clampZoom = (n: number) =>
  Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : ZOOM_DEFAULT;

export const defaultSettings = (): Settings => ({
  theme: "system",
  zoom: ZOOM_DEFAULT,
});

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
  };
};
