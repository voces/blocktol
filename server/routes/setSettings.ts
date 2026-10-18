import { z } from "zod";
import {
  getUserSettings,
  updateUserLocale,
  updateUserSettings,
} from "../db/user.ts";
import {
  ZOOM_DELAY_MAX,
  ZOOM_DELAY_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../common/settings.ts";
import { method } from "./apiHelpers.ts";

// A partial patch of only what changed, merged onto the stored settings.
// `notifications` merges per toggle: `{ notifications: { lostTop: false } }`
// leaves `dailyFinal` alone.
const settingsBody = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  zoom: z.number().min(ZOOM_MIN).max(ZOOM_MAX).optional(),
  zoomDelay: z.number().min(ZOOM_DELAY_MIN).max(ZOOM_DELAY_MAX).optional(),
  // A BCP-47 tag or the "system" sentinel. Not pinned to the supported locales:
  // the catalog resolves an unsupported tag to English.
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
      // A shallow spread would replace the whole sub-object.
      notifications: { ...current.notifications, ...notifications },
    };
    await updateUserSettings(userId, JSON.stringify(next));
    // An explicit language also drives server-rendered push copy: mirror it
    // onto user.locale (which push reads). "system" means follow the device,
    // and user.locale already holds the locale captured at push-subscribe.
    if (patch.language && patch.language !== "system") {
      await updateUserLocale(userId, patch.language);
    }
    return next;
  },
);
