import { z } from "zod";
import { getVapidPublicKey } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// The VAPID public key the client subscribes with (applicationServerKey).
// Public, so unauthenticated. `null` when push isn't configured: the client
// then hides push and keeps notifications in-app.
export const pushConfig = method(z.object({}).optional())(
  () => ({ publicKey: getVapidPublicKey() }),
);
