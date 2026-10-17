import { z } from "zod";
import { upsertSubscription } from "../../db/notification.ts";
import { updateUserLocale } from "../../db/user.ts";
import { isPushEndpoint, sha256hex } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// Register this client's Web Push subscription against the signed-in user. The
// body is a PushSubscription's JSON (endpoint + the RFC 8291 keys) plus the
// device's `locale`, captured passively so server-rendered copy can match it;
// the endpoint's hash is the storage key, so re-subscribing (or a device that
// moved accounts) upserts one row rather than duplicating. The locale is a
// property of the user (any future server-rendered surface can reuse it), so it
// lands on the user row, not the subscription.
//
// The endpoint is where the server will POST, so it must be a real browser push
// service (isPushEndpoint — https + an allowlisted host), never an arbitrary
// url. The keys are base64url: p256dh a 65-byte P-256 point (87 chars), auth a
// 16-byte secret (22 chars); the bounds leave slack for padding without letting
// a body park kilobytes in the row.
const base64url = /^[A-Za-z0-9_-]+={0,2}$/;
const body = z.object({
  endpoint: z.string().max(2048).refine(isPushEndpoint, {
    message: "not a supported push service endpoint",
  }),
  keys: z.object({
    p256dh: z.string().min(80).max(100).regex(base64url),
    auth: z.string().min(16).max(32).regex(base64url),
  }),
  // A BCP-47 tag from the client (Intl.DateTimeFormat().resolvedOptions()).
  // Capped here; canonicalised (or dropped) below before it's stored.
  locale: z.string().max(35).optional(),
});

// Canonicalise the reported locale tag, or drop it if malformed — a bad value
// must never reach Intl when copy is rendered (it would throw).
const canonicalLocale = (locale: string | undefined): string | null => {
  if (!locale) return null;
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? null;
  } catch {
    return null;
  }
};

export const subscribePush = method(body, true)(
  async ({ userId, endpoint, keys, locale }) => {
    const hash = await sha256hex(endpoint);
    const canonical = canonicalLocale(locale);
    await Promise.all([
      upsertSubscription(userId, hash, endpoint, keys.p256dh, keys.auth),
      // Only when we actually have a good tag — never clobber a known locale
      // with null (an old client that sends nothing).
      canonical ? updateUserLocale(userId, canonical) : Promise.resolve(),
    ]);
    return { ok: true as const };
  },
);
