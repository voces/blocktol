import { z } from "zod";
import {
  getUserSettings,
  updateUserLocale,
  updateUserSettings,
} from "../db/user.ts";
import { ZOOM_MAX, ZOOM_MIN } from "../../common/settings.ts";
import { method } from "./apiHelpers.ts";

// A partial patch — the client sends only what changed. Merged onto the stored
// settings so the untouched field is preserved. `notifications` is itself merged
// per-toggle below, so sending only `{ notifications: { lostTop: false } }`
// leaves `dailyFinal` untouched.
const settingsBody = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  zoom: z.number().min(ZOOM_MIN).max(ZOOM_MAX).optional(),
  // A BCP-47 tag or the "system" sentinel; bounded so a junk value can't bloat
  // the row. The catalog tolerates an unsupported tag (resolves to English), so
  // we don't pin it to the current locale set here.
  language: z.string().max(35).optional(),
  notifications: z.object({
    lostTop: z.boolean().optional(),
    dailyFinal: z.boolean().optional(),
  }).optional(),
});

export const setSettings = method(settingsBody, true)(
  async ({ userId, notifications, ...patch }) => {
    const current = await getUserSettings(userId);
    const next = {
      ...current,
      ...patch,
      // Deep-merge the notification toggles so a single-toggle patch doesn't drop
      // the other (a shallow spread would replace the whole sub-object).
      notifications: { ...current.notifications, ...notifications },
    };
    await updateUserSettings(userId, JSON.stringify(next));
    // An EXPLICIT language choice also drives server-rendered push copy: mirror
    // it onto user.locale (which push reads). "system" is left alone — that path
    // means "follow the device", and user.locale is already the browser locale
    // captured passively at push-subscribe, so the two stay in step.
    if (patch.language && patch.language !== "system") {
      await updateUserLocale(userId, patch.language);
    }
    return next;
  },
);
