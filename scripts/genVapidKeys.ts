// Generate a VAPID keypair for Web Push, in the base64url format the server
// reads (see server/util/webpush.ts):
//   - VAPID_PUBLIC_KEY   the raw 65-byte P-256 public point (public; the client
//                        fetches it via /api/pushConfig to subscribe)
//   - VAPID_PRIVATE_KEY  the 32-byte private scalar (SECRET, never commit it)
//   - VAPID_SUBJECT      a mailto: (or https:) contact push services require
//
// Set the three as environment variables on the deployment (private key as a
// secret). Until then notifications stay in-app only, SILENTLY: with no key,
// /api/pushConfig answers `{publicKey:null}`, the client can't subscribe, and
// notifyDailyFinals/notifyLostTop return before sending, so nothing is logged.
// Check with `curl -X POST <host>/api/pushConfig -d '{}'`; null means push is
// off.
//
// ROTATING the keys invalidates every existing subscription, and is hard to
// diagnose: a subscription minted under a retired key fails with 403, which is
// neither 404 nor 410, so the fan-out never prunes it. Recovery is client-side:
// `keyMatches` in client/util/push.ts compares the subscription's
// applicationServerKey with this one and re-subscribes on a mismatch. Prefer
// restoring the ORIGINAL pair over minting a new one; then live subscriptions
// keep working untouched.
//
// WebCrypto only:
//   node scripts/genVapidKeys.ts [mailto:you@example.com]

import process from "node:process";

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
) as CryptoKeyPair;

// Public key: the uncompressed raw point (0x04 ‖ X ‖ Y). Private key: the JWK
// `d`, already the base64url of the 32-byte scalar the server imports.
const publicKey = b64url(
  new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)),
);
const { d: privateKey } = await crypto.subtle.exportKey(
  "jwk",
  keyPair.privateKey,
);

const subject = process.argv[2] ?? "mailto:you@example.com";

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
if (!process.argv[2]) {
  console.error("\n# Pass a contact to set VAPID_SUBJECT, e.g.:");
  console.error(
    "#   node scripts/genVapidKeys.ts mailto:admin@blocktol.com",
  );
}
