import { z } from "zod";
import { markAllRead, markRead, unreadCount } from "../../db/notification.ts";
import { method } from "../apiHelpers.ts";

// Mark notifications read: specific `ids` (opening one), or all when omitted
// ("Mark all read"). Returns the fresh unread count so the badge updates without
// a refetch.
const body = z.object({ ids: z.array(z.number()).optional() });

export const markNotificationsRead = method(body, true)(
  async ({ userId, ids }) => {
    if (ids && ids.length > 0) await markRead(userId, ids);
    else await markAllRead(userId);
    return { unread: await unreadCount(userId) };
  },
);
