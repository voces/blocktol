import { z } from "zod";
import { upsertSubscription } from "../../db/notification.ts";
import { updateUserLocale } from "../../db/user.ts";
import { canonicalLocale } from "../../util/locale.ts";
import { isPushEndpoint, sha256hex } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// Register this client's Web Push subscription for the signed-in user. The body
// is a PushSubscription's JSON (endpoint + RFC 8291 keys) plus the device's
// `locale`, so server-rendered copy can match it. The endpoint's hash is the
// storage key, so re-subscribing (or a device that moved accounts) upserts one
// row. The locale lands on the user row, not the subscription.
//
// The server POSTs to the endpoint, so it must pass isPushEndpoint (https +
// allowlisted host), never an arbitrary url. The keys are base64url: p256dh a
// 65-byte P-256 point (87 chars), auth a 16-byte secret (22 chars); the bounds
// leave slack for padding without letting a body park kilobytes in the row.
const base64url = /^[A-Za-z0-9_-]+={0,2}$/;
const body = z.object({
  endpoint: z.string().max(2048).refine(isPushEndpoint, {
    message: "not a supported push service endpoint",
  }),
  keys: z.object({
    p256dh: z.string().min(80).max(100).regex(base64url),
    auth: z.string().min(16).max(32).regex(base64url),
  }),
  // A BCP-47 tag; canonicalised (or dropped) by `canonicalLocale` before
  // storage.
  locale: z.string().max(35).optional(),
});

export const subscribePush = method(body, true)(
  async ({ userId, endpoint, keys, locale }) => {
    const hash = await sha256hex(endpoint);
    const canonical = canonicalLocale(locale);
    await Promise.all([
      upsertSubscription(userId, hash, endpoint, keys.p256dh, keys.auth),
      // Never clobber a known locale with null (a client that sends none).
      canonical ? updateUserLocale(userId, canonical) : Promise.resolve(),
    ]);
    return { ok: true as const };
  },
);
