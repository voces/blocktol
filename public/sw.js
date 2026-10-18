// Blocktol service worker.
//
// The server injects the asset manifest (ASSET_VERSION, the precache list, the
// notification ICON url) at serve time, replacing the marker comment below (see
// server/util/assets.ts). The defaults keep this file valid JS untransformed.
let ASSET_VERSION = "dev";
let PRECACHE = ["/", "/index.html"];
let ICON = "/favicon.svg";
// The server's VAPID public key, injected with the manifest so
// `pushsubscriptionchange` can re-subscribe with no page open. Empty when push
// isn't configured.
let VAPID_PUBLIC_KEY = "";
/* __ASSET_MANIFEST__ */

// Per-build cache: a new ASSET_VERSION makes a new cache, and `activate`
// deletes the old ones. Fonts are content-addressed, so their cache survives.
const ASSET_CACHE = `blocktol-assets-${ASSET_VERSION}`;
const FONT_CACHE = "blocktol-fonts";
// Where the page mirrors the device credential for the SW (see
// client/util/push.ts). A SW can't reach localStorage and
// `pushsubscriptionchange` fires with no page open, so re-registering needs a
// store both sides see. Cache Storage has the same same-origin exposure as the
// localStorage copy.
const CRED_CACHE = "blocktol-cred";
const CRED_URL = "/__push-credential";
// Self-hosted font files (public/fonts/); the name carries a hash of the bytes,
// so a cached copy is never stale. fonts.css itself is a `?v` asset.
const FONT_FILE = /^\/fonts\/[a-z0-9-]+-[0-9a-f]{8}\.woff2$/;

self.addEventListener("install", (event) => {
  // Precache entries independently so one missing asset can't fail the install
  // (cache.addAll is all-or-nothing). `?v` entries are verified (see
  // putIfVersion).
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map(async (url) => {
        const res = await fetch(url);
        if (res.ok) await putIfVersion(cache, url, res);
      }))
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if ("navigationPreload" in self.registration) {
        await self.registration.navigationPreload.enable();
      }
      // Drop caches from older builds.
      const keep = new Set([ASSET_CACHE, FONT_CACHE, CRED_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// The `?v` a response's bytes deserve: the same truncated SHA-256 as
// `shortHash` in server/util/assets.ts (keep the two in step).
const contentVersion = async (res) => {
  const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Serve from cache, filling on a miss. For fingerprinted assets, whose url
// changes with content, so a hit is never stale. Only bytes that match the
// requested `?v` are cached: during an in-place deploy the outgoing process
// still stamps its old `?v` over new files on disk, and caching those bytes
// under the old url loops the client (new bundle, old server SHA, reload, same
// cached bundle). A mismatch is served but never stored.
const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) putIfVersion(cache, request, res.clone()).catch(() => {});
  return res;
};

// Store `res` for `request`; a versioned url is stored only if the bytes match
// (see cacheFirst).
const putIfVersion = async (cache, request, res) => {
  const v = new URL(request.url ?? request, self.location.origin).searchParams
    .get("v");
  if (v && (await contentVersion(res.clone())) !== v) return;
  await cache.put(request, res);
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // The API is always live; never serve it from a cache.
  if (url.pathname.startsWith("/api/")) return;
  if (url.protocol === "chrome-extension:") return;
  // SW-private state, not a served resource. The offline fallback's
  // `caches.match()` searches EVERY cache, so leave this url to the network
  // (a 404) rather than answer it out of CRED_CACHE.
  if (url.pathname === CRED_URL) return;

  // Navigations: network-first so a fresh shell wins online; the cached shell
  // opens the PWA offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          return await fetch(request);
        } catch {
          const cache = await caches.open(ASSET_CACHE);
          return (await cache.match("/index.html")) ||
            (await cache.match("/")) ||
            Response.error();
        }
      })(),
    );
    return;
  }

  // Font files (content-addressed): cache-first, kept across builds.
  if (url.origin === self.location.origin && FONT_FILE.test(url.pathname)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Fingerprinted same-origin assets (`?v=`): immutable, so cache-first.
  if (url.origin === self.location.origin && url.searchParams.has("v")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Other same-origin GETs: network, falling back to any cached copy offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).catch(async () =>
        (await caches.match(request)) || Response.error()
      ),
    );
  }
});

// ---- Web Push ----

// The payload is the JSON the server encrypted (server/util/notify.ts):
// { title, body, tag, url }. `tag` coalesces repeats of the same kind+day.
// userVisibleOnly subscriptions MUST show a notification per push, so a missing
// or unparseable payload falls back to a generic one.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    (async () => {
      // Tell EVERY open tab, focused or not, to refresh its store; a visible
      // tab also swings its bell silently.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        client.postMessage({ type: "notification" });
      }
      // System banner only when nothing is on screen; a visible tab handles it
      // in-app (userVisibleOnly tolerates this skip).
      if (clients.some((c) => c.visibilityState === "visible")) return;

      const title = data.title || "Blocktol";
      const options = {
        body: data.body || "",
        tag: data.tag,
        icon: ICON,
        badge: ICON,
        data: { url: data.url || "/" },
      };
      await self.registration.showNotification(title, options);
    })(),
  );
});

// Tapping a notification focuses an app window (navigating it to the target) or
// opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if (!("focus" in client)) continue;
        // On Android Chrome navigate() returns a FRESH client handle, and
        // focusing the stale one is a silent no-op. Focus what navigate()
        // returns.
        if ("navigate" in client && new URL(client.url).pathname !== url) {
          const navigated = await client.navigate(url).catch(() => null);
          return (navigated || client).focus();
        }
        return client.focus();
      }
      // No window client: launch the app. On Android Chrome openWindow can open
      // the PWA WITHOUT foregrounding it, so the tap looks like it did nothing.
      // Focus the opened window.
      if (!self.clients.openWindow) return;
      const opened = await self.clients.openWindow(url).catch(() => null);
      if (opened && "focus" in opened) await opened.focus().catch(() => {});
    })(),
  );
});

// ---- Subscription rotation ----

// base64url VAPID key -> the Uint8Array applicationServerKey expects. Copy of
// the one in client/util/push.ts; the SW can't import from the bundle.
const vapidKeyBytes = (base64) => {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

const readCredential = async () => {
  try {
    const cache = await caches.open(CRED_CACHE);
    const hit = await cache.match(CRED_URL);
    return hit ? (await hit.text()).trim() || null : null;
  } catch {
    return null;
  }
};

const callApi = async (method, credential, body) =>
  fetch(`/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: credential },
    body: JSON.stringify(body),
  });

// The browser can retire a push subscription on its own (Chrome on Android
// after Play Services re-registration, an update, or long idle; also a
// userVisibleOnly budget revocation). The server-side endpoint then 410s and
// the fan-out prunes the row (server/util/notify.ts), leaving a player whose
// toggles read "on" receiving nothing.
//
// Waiting for syncPushSubscription() on the next app open isn't enough: the
// push that would bring the player back never arrives. Re-subscribe and
// re-register here, while the SW holds the event.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const credential = await readCredential();
      // No mirrored credential (page never ran the current client) or no server
      // key: the next app open re-registers.
      if (!credential || !VAPID_PUBLIC_KEY) return;

      try {
        // Chrome fires this WITHOUT newSubscription, so we mint one; Firefox
        // supplies one. The old subscription is already invalid either way.
        const sub = event.newSubscription ||
          await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyBytes(VAPID_PUBLIC_KEY),
          });
        const json = sub.toJSON();
        if (
          !json.endpoint || !json.keys || !json.keys.p256dh || !json.keys.auth
        ) return;

        await callApi("subscribePush", credential, {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        });

        // Drop the dead row when the browser names it; otherwise the next send
        // 410s and the fan-out prunes it.
        const old = event.oldSubscription && event.oldSubscription.endpoint;
        if (old && old !== json.endpoint) {
          await callApi("unsubscribePush", credential, { endpoint: old })
            .catch(() => {});
        }
      } catch {
        // Best-effort (revoked, offline, refused); syncPushSubscription()
        // retries on the next app open.
      }
    })(),
  );
});
