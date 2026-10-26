// A dependency-free Web Push sender on WebCrypto: VAPID request authorization
// (RFC 8292) plus "aes128gcm" payload encryption (RFC 8291 over RFC 8188). The
// npm `web-push` package's transitive deps read arbitrary env vars at load
// (ECE_KEYLOG, DEBUG, …); this reads only the VAPID_* vars. The encryption is verified against RFC 8291 §5's test
// vector (webpush.test.ts).

import { errText, log } from "./logging.ts";
import process from "node:process";

// An ArrayBuffer-backed byte array: WebCrypto's BufferSource params reject a
// bare `Uint8Array` (`ArrayBufferLike`).
type Bytes = Uint8Array<ArrayBuffer>;

// ---- base64url ----

const B64URL = (bytes: Bytes): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64URL = (s: string): Bytes => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const utf8 = (s: string): Bytes => new TextEncoder().encode(s);

// SHA-256 hex of a string: the storage key for a push endpoint (unique but too
// long to index). Shared by the subscribe route and dead-subscription pruning.
export const sha256hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", utf8(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const concat = (...parts: Bytes[]): Bytes => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

// ---- HKDF (RFC 5869) via WebCrypto: one extract+expand per call ----

const hkdf = async (
  salt: Bytes,
  ikm: Bytes,
  info: Bytes,
  length: number,
): Promise<Bytes> => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
};

// ---- VAPID keys (a P-256 keypair, base64url like `web-push`'s output) ----

export type VapidKeys = { publicKey: string; privateKey: string };

// A JWK from the raw VAPID keys: the public key is a 65-byte uncompressed point
// (0x04 ‖ X ‖ Y), the private key the 32-byte scalar d.
const vapidJwk = (publicKey: string, privateKey: string): JsonWebKey => {
  const pub = fromB64URL(publicKey);
  return {
    kty: "EC",
    crv: "P-256",
    x: B64URL(pub.slice(1, 33)),
    y: B64URL(pub.slice(33, 65)),
    d: privateKey,
    ext: true,
  };
};

// Sign a VAPID JWT (ES256). `aud` is the push endpoint's origin; `exp` is 12h
// out (RFC 8292 caps it at 24h). WebCrypto's ECDSA output is already JOSE
// r‖s.
const signVapidJwt = async (
  keys: VapidKeys,
  aud: string,
  subject: string,
  now: number,
): Promise<string> => {
  const header = B64URL(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = B64URL(
    utf8(JSON.stringify({
      aud,
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: subject,
    })),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    vapidJwk(keys.publicKey, keys.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signingInput),
  );
  return `${signingInput}.${B64URL(new Uint8Array(sig))}`;
};

// ---- aes128gcm payload encryption (RFC 8291 / RFC 8188) ----

const RECORD_SIZE = 4096;

// Everything after the ECDH: mix the auth secret and salt into the CEK+nonce
// (RFC 8291 §3.4, RFC 8188), then frame one AES-128-GCM record. Split out so
// the RFC 8291 §5 vector can feed in its published `ecdhSecret` directly.
const sealRecord = async (
  ecdhSecret: Bytes,
  uaPublic: Bytes,
  authSecret: Bytes,
  asPublic: Bytes,
  salt: Bytes,
  payload: Bytes,
): Promise<Bytes> => {
  // RFC 8291 §3.4: input keying material.
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188: content-encryption key and nonce.
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // One record: plaintext ‖ 0x02 (last-record delimiter).
  const record = concat(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      record,
    ),
  );

  // RFC 8188 §2.1 header: salt(16) ‖ rs(4, big-endian) ‖ idlen(1) ‖ keyid.
  // The keyid is the server public key, which the client needs for the ECDH.
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);

  return concat(header, ciphertext);
};

// Exposed only for the RFC 8291 §5 vector test (see webpush.test.ts).
export const _sealRecordForTest = sealRecord;

// Encrypt `payload` for a subscription's client key (`uaPublic`, 65-byte point)
// and `authSecret` (16 bytes). The ephemeral server keypair and salt are fresh
// per message (RFC 8291).
export const encryptPayload = async (
  payload: Bytes,
  uaPublic: Bytes,
  authSecret: Bytes,
): Promise<Bytes> => {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", kp.publicKey),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // ECDH between the ephemeral server key and the client key.
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey },
      kp.privateKey,
      256,
    ),
  );

  return sealRecord(ecdh, uaPublic, authSecret, asPublic, salt, payload);
};

// ---- config from the environment ----

// Read once. Without both keys sends are skipped; in-app notifications still
// work.
const vapidPublic = process.env.VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:admin@blocktol.com";

export const pushConfigured = (): boolean => !!(vapidPublic && vapidPrivate);

// The client needs the public key to subscribe (applicationServerKey). null
// when push isn't configured.
export const getVapidPublicKey = (): string | null => vapidPublic ?? null;

// ---- which endpoints we'll POST to ----

// An endpoint is client-supplied and the server POSTs to it, so accepting any
// URL would be an SSRF gadget (localhost, the SQL proxy, loopback-only
// VictoriaLogs) and a request amplifier. Only browser vendors' push services
// are allowed:
//   - Chrome-family browsers: FCM (`fcm.googleapis.com`; GCM-era subscriptions
//     carry `android.googleapis.com`, some Chrome builds `jmt17.google.com`).
//   - Firefox: Mozilla autopush, suffix-matched for regional/legacy hosts.
//   - Edge: WNS, `<region>.notify.windows.com`.
//   - Safari (macOS 13+, iOS 16.4+ home-screen apps): `web.push.apple.com`,
//     suffix-matched on push.apple.com.
// Self-hosted push (UnifiedPush) is excluded: its endpoint can be any host.
const PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "jmt17.google.com",
]);
const PUSH_HOST_SUFFIXES = [
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
];

// https, default port, no credentials, and an allowlisted host.
export const isPushEndpoint = (endpoint: string): boolean => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) ||
    PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
};

// Hosts already reported as refused, so a row stored before the subscribe
// allowlist logs once per process, not on every send.
const refusedHosts = new Set<string>();

// A hung push service must not hang the caller: lost-top pushes run inside a
// player's save (onPbBuild) and the daily-final fan-out inside the rate-dailies
// cron, which never overlaps itself, so one stuck socket would stall every
// later rating.
const PUSH_TIMEOUT_MS = 10_000;

export type WebPushSubscription = {
  endpoint: string;
  p256dh: string; // client public key, base64url (65-byte point)
  auth: string; // client auth secret, base64url (16 bytes)
};

// `gone` marks a subscription the push service rejected as expired (404/410),
// for the caller to prune. `ok` is any 2xx.
export type SendResult = { ok: boolean; gone: boolean; status?: number };

// Send one push. `now` is injectable to test the JWT exp. Never throws:
// transport/crypto failures resolve to { ok: false }.
export const sendPush = async (
  sub: WebPushSubscription,
  payload: string,
  ttlSeconds = 24 * 3600,
  now: number = Date.now(),
): Promise<SendResult> => {
  if (!vapidPublic || !vapidPrivate) return { ok: false, gone: false };
  if (!isPushEndpoint(sub.endpoint)) {
    // A row stored before subscribe enforced the allowlist. Skipped, not
    // pruned: a real endpoint the list misses should be recoverable by widening
    // the list.
    let host = "invalid";
    try {
      host = new URL(sub.endpoint).host;
    } catch { /* unparseable — "invalid" */ }
    if (!refusedHosts.has(host)) {
      refusedHosts.add(host);
      log.warn("push endpoint refused (not an allowlisted push service)", {
        host,
      });
    }
    return { ok: false, gone: false };
  }
  try {
    const origin = new URL(sub.endpoint).origin;
    const jwt = await signVapidJwt(
      { publicKey: vapidPublic, privateKey: vapidPrivate },
      origin,
      vapidSubject,
      now,
    );
    const body = await encryptPayload(
      utf8(payload),
      fromB64URL(sub.p256dh),
      fromB64URL(sub.auth),
    );
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": String(ttlSeconds),
        "Authorization": `vapid t=${jwt}, k=${vapidPublic}`,
      },
      body,
      // Covers the body drain below too: the signal aborts the stream.
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      // Never follow a redirect off the allowlisted host.
      redirect: "manual",
    });
    // Always drain the body so the connection can be reused/closed. On a
    // failure it carries the push service's reason (Apple sends
    // `{"reason":"BadJwtToken"}`), the only way to tell one 400 from another.
    const reply = await res.text().catch(() => "");
    const gone = res.status === 404 || res.status === 410;
    if (!res.ok && !gone) {
      // A 403 means the subscription wasn't minted under the VAPID key signing
      // this request (keys rotated), so it is permanently undeliverable. NOT
      // pruned: a 403 is equally consistent with a misconfigured key pair, and
      // pruning would delete every subscription in one sweep. The client
      // re-subscribes on its next boot (client/util/push.ts `keyMatches`); this
      // log is the only trace until then.
      log.error(
        res.status === 403
          ? "push send rejected (vapid key)"
          : "push send failed",
        {
          status: res.status,
          reason: reply.slice(0, 200),
          endpoint: sub.endpoint.slice(0, 60),
        },
      );
    }
    return { ok: res.ok, gone, status: res.status };
  } catch (err) {
    log.error("push send error", { error: errText(err) });
    return { ok: false, gone: false };
  }
};
