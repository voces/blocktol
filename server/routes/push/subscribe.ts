import { z } from "zod";
import { upsertSubscription } from "../../db/notification.ts";
import { sha256hex } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// Register this client's Web Push subscription against the signed-in user. The
// body is exactly a PushSubscription's JSON (endpoint + the RFC 8291 keys); the
// endpoint's hash is the storage key, so re-subscribing (or a device that moved
// accounts) upserts one row rather than duplicating.
const body = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const subscribePush = method(body, true)(
  async ({ userId, endpoint, keys }) => {
    const hash = await sha256hex(endpoint);
    await upsertSubscription(userId, hash, endpoint, keys.p256dh, keys.auth);
    return { ok: true as const };
  },
);
