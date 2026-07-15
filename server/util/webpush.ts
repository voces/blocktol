// A dependency-free Web Push sender built on WebCrypto: VAPID request
// authorization (RFC 8292) plus "aes128gcm" payload encryption (RFC 8291 over
// RFC 8188). The npm `web-push` package works under Deno but its transitive deps
// read arbitrary env vars at load (ECE_KEYLOG, DEBUG, …), which trips this app's
// deliberately-scoped `--allow-env`; a native implementation reads only the
// first-party VAPID_* vars and keeps the permission surface tight. The
// encryption pipeline is verified against RFC 8291 §5's published test vector
// (see webpush.test.ts).

import { errText, log } from "./logging.ts";

// An ArrayBuffer-backed byte array — the shape WebCrypto's BufferSource params
// require under the strict typed-array generics (a bare `Uint8Array` defaults to
// `ArrayBufferLike`, which the crypto overloads reject).
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

// SHA-256 hex of a string — the storage key for a push endpoint (endpoints are
// globally unique but too long to index directly). Shared by the subscribe route
// and the send path's dead-subscription pruning.
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

// Build a JWK from the raw VAPID key material so WebCrypto can import it: the
// public key is a 65-byte uncompressed point (0x04 ‖ X ‖ Y); the private key is
// the 32-byte scalar d.
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

// Sign a VAPID JWT (ES256). `aud` is the push endpoint's origin; `exp` is capped
// at 24h out per RFC 8292. WebCrypto's ECDSA output is already the JOSE raw r‖s.
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
// (RFC 8291 §3.4 then RFC 8188), then frame one AES-128-GCM record. Split out so
// it can be verified against RFC 8291 §5's vector using the RFC's published
// `ecdhSecret` — Deno's WebCrypto can't deriveBits from an imported private key,
// so a fixed server key can't be injected, but the raw shared secret can.
const sealRecord = async (
  ecdhSecret: Bytes,
  uaPublic: Bytes,
  authSecret: Bytes,
  asPublic: Bytes,
  salt: Bytes,
  payload: Bytes,
): Promise<Bytes> => {
  // RFC 8291 §3.4: mix the auth secret in to get the input keying material.
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188: derive the content-encryption key and nonce from the salt.
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // One record: plaintext ‖ 0x02 (the last-record delimiter), then AES-128-GCM.
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
  // The keyid is the server public key so the client can complete the ECDH.
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
// and `authSecret` (16 bytes). A fresh ephemeral server keypair and random salt
// are generated per message (never reused, per RFC 8291).
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

  // ECDH shared secret between the server ephemeral key and the client key.
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

// Tolerant read: returns undefined for an absent OR unpermitted var rather than
// throwing, so importing this module under a scoped --allow-env (e.g. the test
// task, which doesn't grant VAPID_*) is safe — push just reads as unconfigured.
const readEnv = (name: string): string | undefined => {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
};

// Read once; a missing key means push is not configured, so sends are skipped
// (in-app notifications still work regardless).
const vapidPublic = readEnv("VAPID_PUBLIC_KEY");
const vapidPrivate = readEnv("VAPID_PRIVATE_KEY");
const vapidSubject = readEnv("VAPID_SUBJECT") ?? "mailto:admin@blocktol.com";

export const pushConfigured = (): boolean => !!(vapidPublic && vapidPrivate);

// The client needs the public key to subscribe (applicationServerKey); it's
// public by definition. null when push isn't configured.
export const getVapidPublicKey = (): string | null => vapidPublic ?? null;

export type WebPushSubscription = {
  endpoint: string;
  p256dh: string; // client public key, base64url (65-byte point)
  auth: string; // client auth secret, base64url (16 bytes)
};

// The result of a send: `gone` marks a subscription the push service rejected as
// expired/invalid (404/410), so the caller can prune it. `ok` is any 2xx.
export type SendResult = { ok: boolean; gone: boolean; status?: number };

// Send one push. `now` is injectable for testing the JWT exp. Never throws —
// transport/crypto failures resolve to { ok:false }, so a dead endpoint can't
// break notification creation.
export const sendPush = async (
  sub: WebPushSubscription,
  payload: string,
  ttlSeconds = 24 * 3600,
  now: number = Date.now(),
): Promise<SendResult> => {
  if (!vapidPublic || !vapidPrivate) return { ok: false, gone: false };
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
    });
    // Drain the body so the connection can be reused/closed.
    await res.arrayBuffer().catch(() => {});
    const gone = res.status === 404 || res.status === 410;
    if (!res.ok && !gone) {
      log.error("push send failed", {
        status: res.status,
        endpoint: sub.endpoint.slice(0, 60),
      });
    }
    return { ok: res.ok, gone, status: res.status };
  } catch (err) {
    log.error("push send error", { error: errText(err) });
    return { ok: false, gone: false };
  }
};
