// Client-side Web Push: turn a browser PushSubscription into a server-stored
// subscription, and tear it down again. All of it is feature-detected and
// best-effort — a browser without push, a denied permission, or a missing VAPID
// key just leaves notifications in-app only.

import { signal } from "@preact/signals";
import { api } from "../api.ts";
import { getId } from "./id.ts";
import { getLocale } from "./locale.ts";

// What this device can ACTUALLY do about push, as opposed to what the player's
// preference toggles say. The two were never connected: the toggles are stored
// settings that gate the SERVER's send decision, so they read "on" just the same
// when the browser blocked permission, when the subscription died, or when push
// isn't configured at all — the "toggled on but nothing arrives" report. Profile
// reads this to say which it is.
export type PushStatus =
  | "unknown" // not probed yet
  | "ok" // subscribed and registered with the server
  | "prompt" // supported, but permission hasn't been granted
  | "denied" // blocked by the browser (or an OS setting the browser mirrors)
  | "unavailable"; // no push support, no server VAPID key, or registration failed

export const pushState = signal<PushStatus>("unknown");

export const pushSupported = (): boolean =>
  "serviceWorker" in navigator &&
  "PushManager" in globalThis &&
  "Notification" in globalThis;

export const pushPermission = (): NotificationPermission =>
  pushSupported() ? Notification.permission : "denied";

// The server's VAPID public key, fetched once (it's public). null when push
// isn't configured server-side.
let publicKeyPromise: Promise<string | null> | null = null;
const getPublicKey = (): Promise<string | null> => {
  if (!publicKeyPromise) {
    publicKeyPromise = api.pushConfig({})
      .then((r) => (r && !("error" in r) ? r.publicKey : null))
      .catch(() => null);
  }
  return publicKeyPromise;
};

// base64url VAPID key → the Uint8Array applicationServerKey expects.
const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

// Cache Storage is the only same-origin store a service worker can read without
// a page (localStorage isn't reachable from a worker at all), and the SW needs
// the device credential to re-register a rotated subscription while no tab is
// open — see the `pushsubscriptionchange` handler in public/sw.js. This mirrors
// the id that already lives in localStorage between two same-origin stores; it
// crosses no boundary and never leaves the device.
const CRED_CACHE = "blocktol-cred";
const CRED_URL = "/__push-credential";

const mirrorCredential = async (): Promise<void> => {
  try {
    const cache = await caches.open(CRED_CACHE);
    await cache.put(CRED_URL, new Response(getId()));
  } catch {
    // No Cache Storage (blocked site data): the SW simply can't self-heal, and
    // the next app open re-registers as before.
  }
};

// Does an existing subscription's applicationServerKey match the server's
// CURRENT VAPID key? A subscription minted under a retired key is permanently
// undeliverable — the push service rejects the send with 403, which is not the
// 404/410 the fan-out prunes on, so the row survives forever and this client
// happily re-registers the same dead endpoint on every boot. That is the failure
// this comparison exists to break.
//
// `applicationServerKey` is only readable where the browser exposes it; when it
// isn't, return true (treat as matching) rather than churning a subscription
// that may well be fine.
export const keyMatches = (
  applied: ArrayBuffer | null | undefined,
  key: string,
): boolean => {
  if (!applied) return true;
  const have = new Uint8Array(applied);
  const want = urlBase64ToUint8Array(key);
  return have.length === want.length && have.every((b, i) => b === want[i]);
};

// Subscribe this client and register it with the server. Assumes permission is
// already granted (see requestPushPermission). Returns true on success. Reuses
// an existing browser subscription when one's present (re-registering it is
// harmless — the server upserts by endpoint), unless it was minted under a
// different VAPID key, in which case it's replaced.
export const subscribePush = async (): Promise<boolean> => {
  if (!pushSupported()) {
    pushState.value = "unavailable";
    return false;
  }
  if (Notification.permission !== "granted") {
    pushState.value = Notification.permission === "denied"
      ? "denied"
      : "prompt";
    return false;
  }
  try {
    const key = await getPublicKey();
    if (!key) {
      pushState.value = "unavailable"; // push not configured server-side
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    // A stale-key subscription is dead weight: drop it here AND server-side
    // (nothing else would — 403 doesn't prune), then mint a fresh one.
    if (sub && !keyMatches(sub.options?.applicationServerKey, key)) {
      const stale = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await api.unsubscribePush({ endpoint: stale }).catch(() => {});
      sub = null;
    }

    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      pushState.value = "unavailable";
      return false;
    }
    const r = await api.subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      // Passively captured so server-rendered push copy matches this device.
      locale: getLocale(),
    });
    const ok = !!r && !("error" in r);
    if (ok) await mirrorCredential();
    pushState.value = ok ? "ok" : "unavailable";
    return ok;
  } catch {
    pushState.value = "unavailable";
    return false;
  }
};

// Ask for notification permission (a user gesture must be in progress on iOS),
// then subscribe if granted. Returns the resulting permission.
export const requestPushPermission = async (): Promise<
  NotificationPermission
> => {
  if (!pushSupported()) {
    pushState.value = "unavailable";
    return "denied";
  }
  if (Notification.permission === "granted") {
    await subscribePush();
    return "granted";
  }
  if (Notification.permission === "denied") {
    pushState.value = "denied";
    return "denied";
  }
  const perm = await Notification.requestPermission().catch(() => "denied");
  if (perm === "granted") await subscribePush();
  else pushState.value = perm === "denied" ? "denied" : "prompt";
  return perm as NotificationPermission;
};

// Drop the browser subscription and deregister it server-side.
export const unsubscribePush = async (): Promise<void> => {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await api.unsubscribePush({ endpoint }).catch(() => {});
    // Drop the SW's copy of the credential too — with no subscription there's
    // nothing for it to re-register, and the mirror shouldn't outlive the need.
    await caches.delete(CRED_CACHE).catch(() => {});
    pushState.value = "prompt";
  } catch {
    // best-effort
  }
};

// On boot: if permission is already granted, make sure the current browser
// subscription is registered with the server (endpoints can rotate) and still
// matches the server's VAPID key. No prompt — this only ever runs silently for
// users who already opted in. When permission ISN'T granted we still record the
// state, so Profile can say why nothing is arriving instead of showing a toggle
// that reads "on" and means nothing.
export const syncPushSubscription = (): void => {
  if (!pushSupported()) {
    pushState.value = "unavailable";
    return;
  }
  const perm = pushPermission();
  if (perm === "granted") void subscribePush();
  else pushState.value = perm === "denied" ? "denied" : "prompt";
};
