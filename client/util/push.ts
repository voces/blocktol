// Client-side Web Push: register a browser PushSubscription with the server and
// tear it down again. Everything is feature-detected and best-effort; without
// push support, permission or a VAPID key, notifications stay in-app only.

import { signal } from "@preact/signals";
import { api } from "../api.ts";
import { getId } from "./id.ts";
import { getLocale } from "./locale.ts";

// What this device can ACTUALLY do about push, separate from the player's
// preference toggles, which only gate the SERVER's send decision and read "on"
// even when permission is blocked, the subscription died, or push isn't
// configured. Profile reads this to say why nothing arrives.
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

// The server's VAPID public key, fetched once. null when push isn't configured
// server-side.
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

// The service worker needs the device credential to re-register a rotated
// subscription while no tab is open (the `pushsubscriptionchange` handler in
// public/sw.js). localStorage isn't reachable from a worker, so the id is
// mirrored into Cache Storage. It never leaves the device.
const CRED_CACHE = "blocktol-cred";
const CRED_URL = "/__push-credential";

const mirrorCredential = async (): Promise<void> => {
  try {
    const cache = await caches.open(CRED_CACHE);
    await cache.put(CRED_URL, new Response(getId()));
  } catch {
    // No Cache Storage (blocked site data): the SW can't self-heal; the next
    // app open re-registers.
  }
};

// Does an existing subscription's applicationServerKey match the server's
// CURRENT VAPID key? A subscription minted under a retired key is permanently
// undeliverable: the push service answers 403, not the 404/410 the fan-out
// prunes on, so the row survives and this client would re-register the same
// dead endpoint every boot.
//
// `applicationServerKey` is readable only where the browser exposes it; when it
// isn't, treat it as matching rather than churn a possibly good subscription.
export const keyMatches = (
  applied: ArrayBuffer | null | undefined,
  key: string,
): boolean => {
  if (!applied) return true;
  const have = new Uint8Array(applied);
  const want = urlBase64ToUint8Array(key);
  return have.length === want.length && have.every((b, i) => b === want[i]);
};

// Subscribe this client and register it with the server; true on success.
// Assumes permission is granted (see requestPushPermission). Reuses an existing
// browser subscription (the server upserts by endpoint) unless it was minted
// under a different VAPID key, in which case it's replaced.
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

    // Drop a stale-key subscription here AND server-side (a 403 never prunes
    // it), then mint a fresh one.
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
      // So server-rendered push copy matches this device.
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
    // With no subscription the SW has nothing to re-register, so drop its
    // credential copy too.
    await caches.delete(CRED_CACHE).catch(() => {});
    pushState.value = "prompt";
  } catch {
    // best-effort
  }
};

// On boot: if permission is already granted, make sure the browser subscription
// is registered with the server (endpoints can rotate) and matches the server's
// VAPID key. Never prompts. When permission ISN'T granted it still records the
// state, for Profile.
export const syncPushSubscription = (): void => {
  if (!pushSupported()) {
    pushState.value = "unavailable";
    return;
  }
  const perm = pushPermission();
  if (perm === "granted") void subscribePush();
  else pushState.value = perm === "denied" ? "denied" : "prompt";
};
