import { z } from "zod";
import {
  markAllRead,
  markRead,
  markReadByDay,
  unreadCount,
} from "../../db/notification.ts";
import { method } from "../apiHelpers.ts";

// Mark notifications read: specific `ids` (opening one in the panel), a day's
// notification of a `kind` (a push deep-link knows the day, not the id), or all
// when nothing is given. Returns the fresh unread count for the badge.
const body = z.object({
  // Bounds the IN (…) list; a user never has this many unread.
  ids: z.array(z.number()).max(1000).optional(),
  iteration: z.number().optional(),
  kind: z.enum(["lost_top", "daily_final"]).optional(),
});

export const markNotificationsRead = method(body, true)(
  async ({ userId, ids, iteration, kind }) => {
    if (ids && ids.length > 0) await markRead(userId, ids);
    else if (iteration != null && kind) {
      await markReadByDay(userId, iteration, kind);
    } else await markAllRead(userId);
    return { unread: await unreadCount(userId) };
  },
);
