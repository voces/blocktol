import { z } from "zod";
import { getVapidPublicKey } from "../../util/webpush.ts";
import { method } from "../apiHelpers.ts";

// The VAPID public key the client needs to subscribe (applicationServerKey). It
// is public by definition, so this is unauthenticated. `null` when push isn't
// configured server-side — the client then hides the push affordance and keeps
// notifications in-app only.
export const pushConfig = method(z.object({}).optional())(
  () => ({ publicKey: getVapidPublicKey() }),
);
