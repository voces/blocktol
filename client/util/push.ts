// Client-side Web Push: turn a browser PushSubscription into a server-stored
// subscription, and tear it down again. All of it is feature-detected and
// best-effort — a browser without push, a denied permission, or a missing VAPID
// key just leaves notifications in-app only.

import { api } from "../api.ts";

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

// Subscribe this client and register it with the server. Assumes permission is
// already granted (see requestPushPermission). Returns true on success. Reuses
// an existing browser subscription when one's present (re-registering it is
// harmless — the server upserts by endpoint).
export const subscribePush = async (): Promise<boolean> => {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const key = await getPublicKey();
    if (!key) return false; // push not configured server-side
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() ??
      await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    const r = await api.subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return !!r && !("error" in r);
  } catch {
    return false;
  }
};

// Ask for notification permission (a user gesture must be in progress on iOS),
// then subscribe if granted. Returns the resulting permission.
export const requestPushPermission = async (): Promise<
  NotificationPermission
> => {
  if (!pushSupported()) return "denied";
  if (Notification.permission === "granted") {
    await subscribePush();
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  const perm = await Notification.requestPermission().catch(() => "denied");
  if (perm === "granted") await subscribePush();
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
  } catch {
    // best-effort
  }
};

// On boot: if permission is already granted, make sure the current browser
// subscription is registered with the server (endpoints can rotate). No prompt —
// this only ever runs silently for users who already opted in.
export const syncPushSubscription = (): void => {
  if (pushPermission() === "granted") void subscribePush();
};
