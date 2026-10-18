import { z } from "zod";
import { listNotifications, unreadCount } from "../../db/notification.ts";
import { method } from "../apiHelpers.ts";

// The user's recent notifications (newest first) plus the unread count: the
// bell badge and its panel.
export const getNotifications = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    const [items, unread] = await Promise.all([
      listNotifications(userId),
      unreadCount(userId),
    ]);
    return { items, unread };
  },
);
