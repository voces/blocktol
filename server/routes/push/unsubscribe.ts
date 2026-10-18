import { z } from "zod";
import { deleteOwnSubscription } from "../../db/notification.ts";
import { sha256hex } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// Drop a Web Push subscription (permission revoked, or both kinds turned off).
// Keyed by the endpoint hash `subscribePush` stores; only the caller's own
// rows.
const body = z.object({ endpoint: z.string().min(1).max(2048) });

export const unsubscribePush = method(body, true)(
  async ({ userId, endpoint }) => {
    await deleteOwnSubscription(userId, await sha256hex(endpoint));
    return { ok: true as const };
  },
);
