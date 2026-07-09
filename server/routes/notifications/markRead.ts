import { z } from "zod";
import {
  markAllRead,
  markRead,
  markReadByDay,
  unreadCount,
} from "../../db/notification.ts";
import { method } from "../apiHelpers.ts";

// Mark notifications read: specific `ids` (opening one in the panel), a day's
// notification of a `kind` (tapping its push deep-link, which knows the day but
// not the id), or all when nothing is given ("Mark all read"). Returns the fresh
// unread count so the badge updates without a refetch.
const body = z.object({
  ids: z.array(z.number()).optional(),
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
