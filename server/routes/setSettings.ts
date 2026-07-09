import { z } from "zod";
import { getUserSettings, updateUserSettings } from "../db/user.ts";
import { ZOOM_MAX, ZOOM_MIN } from "../../common/settings.ts";
import { method } from "./apiHelpers.ts";

// A partial patch — the client sends only what changed. Merged onto the stored
// settings so the untouched field is preserved. `notifications` is itself merged
// per-toggle below, so sending only `{ notifications: { lostTop: false } }`
// leaves `dailyFinal` untouched.
const settingsBody = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  zoom: z.number().min(ZOOM_MIN).max(ZOOM_MAX).optional(),
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
    return next;
  },
);
