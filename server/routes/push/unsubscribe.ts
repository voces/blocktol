import { z } from "zod";
import { deleteSubscription } from "../../db/notification.ts";
import { sha256hex } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// Drop a Web Push subscription (the browser revoked permission, or the user
// turned both kinds off). Keyed by the endpoint's hash — the same identifier the
// subscribe route stores.
const body = z.object({ endpoint: z.string().min(1) });

export const unsubscribePush = method(body, true)(
  async ({ endpoint }) => {
    await deleteSubscription(await sha256hex(endpoint));
    return { ok: true as const };
  },
);
