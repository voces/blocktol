import { z } from "zod";
import { listNotifications, unreadCount } from "../../db/notification.ts";
import { method } from "../apiHelpers.ts";

// The signed-in user's notifications (newest first, recent slice) plus their
// unread count — the data behind the bell badge and its panel. No input beyond
// the auth header.
export const getNotifications = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    const [items, unread] = await Promise.all([
      listNotifications(userId),
      unreadCount(userId),
    ]);
    return { items, unread };
  },
);
