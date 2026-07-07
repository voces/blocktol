import { z } from "zod";
import { getUserSettings, updateUserSettings } from "../db/user.ts";
import { ZOOM_MAX, ZOOM_MIN } from "../../common/settings.ts";
import { method } from "./apiHelpers.ts";

// A partial patch — the client sends only what changed. Merged onto the stored
// settings so the untouched field is preserved.
const settingsBody = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  zoom: z.number().min(ZOOM_MIN).max(ZOOM_MAX).optional(),
});

export const setSettings = method(settingsBody, true)(
  async ({ userId, ...patch }) => {
    const next = { ...(await getUserSettings(userId)), ...patch };
    await updateUserSettings(userId, JSON.stringify(next));
    return next;
  },
);
