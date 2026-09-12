// Generate a VAPID keypair for Web Push, in the exact base64url format the
// server reads (see server/util/webpush.ts):
//   - VAPID_PUBLIC_KEY  — the raw 65-byte P-256 public point (public; the client
//                         fetches it via /api/pushConfig to subscribe)
//   - VAPID_PRIVATE_KEY  — the 32-byte private scalar (SECRET — never commit it)
//   - VAPID_SUBJECT      — a mailto: (or https:) contact the push services require
//
// Set the three as environment variables on the deployment (mark the private key
// secret). Until they're set, notifications stay in-app only — silently: with no
// key, /api/pushConfig answers `{publicKey:null}`, the client can't subscribe,
// and notifyDailyFinals/notifyLostTop return before attempting a single send, so
// NOTHING about the missing config appears in the logs. `curl -X POST
// <host>/api/pushConfig -d '{}'` is the check; a null there means push is off.
//
// ROTATING the keys invalidates every existing subscription. This used to claim
// the server prunes those "as sends 404/410 and clients re-subscribe on next
// load" — it does not, and that assumption is exactly why a rotation was
// undiagnosable. A subscription minted under a retired key fails with **403**,
// which is neither 404 nor 410, so the fan-out does NOT prune it: the row
// survives indefinitely and the client used to re-register the same dead
// endpoint on every boot. Recovery is client-side — `keyMatches` in
// client/util/push.ts compares the subscription's applicationServerKey against
// this one and re-subscribes on a mismatch. So prefer restoring the ORIGINAL
// pair over minting a new one: same keys means every live subscription keeps
// working with no re-subscribe at all.
//
// Needs no permissions (WebCrypto only):
//   deno run scripts/genVapidKeys.ts [mailto:you@example.com]

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
) as CryptoKeyPair;

// Public key: the uncompressed raw point (0x04 ‖ X ‖ Y). Private key: the JWK
// `d` component, which is already the base64url of the 32-byte scalar the server
// imports.
const publicKey = b64url(
  new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)),
);
const { d: privateKey } = await crypto.subtle.exportKey(
  "jwk",
  keyPair.privateKey,
);

const subject = Deno.args[0] ?? "mailto:you@example.com";

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
if (!Deno.args[0]) {
  console.error("\n# Pass a contact to set VAPID_SUBJECT, e.g.:");
  console.error(
    "#   deno run scripts/genVapidKeys.ts mailto:admin@blocktol.com",
  );
}
