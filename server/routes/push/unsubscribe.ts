import { z } from "zod";
import { deleteOwnSubscription } from "../../db/notification.ts";
import { sha256hex } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// Drop a Web Push subscription (the browser revoked permission, or the user
// turned both kinds off). Keyed by the endpoint's hash — the same identifier the
// subscribe route stores — and scoped to the caller's own rows.
const body = z.object({ endpoint: z.string().min(1).max(2048) });

export const unsubscribePush = method(body, true)(
  async ({ userId, endpoint }) => {
    await deleteOwnSubscription(userId, await sha256hex(endpoint));
    return { ok: true as const };
  },
);
