// Blocktol service worker.
//
// The asset manifest — the build's ASSET_VERSION, the precache list, and the
// notification ICON url — is INJECTED by the server at serve time, replacing the
// marker comment below (see server/util/assets.ts). The defaults keep this file
// valid JS if it were ever loaded untransformed (it never is in practice: the
// server always serves it, no-cache, so updates land promptly).
let ASSET_VERSION = "dev";
let PRECACHE = ["/", "/index.html"];
let ICON = "/favicon.svg";
/* __ASSET_MANIFEST__ */

// Per-build cache: bumping ASSET_VERSION (any precached asset changed) makes a
// new cache, and `activate` deletes the old ones. Fonts are cross-origin and
// change rarely, so they live in their own cache that survives version bumps.
const ASSET_CACHE = `blocktol-assets-${ASSET_VERSION}`;
const FONT_CACHE = "blocktol-fonts";
const FONT_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

self.addEventListener("install", (event) => {
  // Precache each entry independently so one missing asset can't fail the whole
  // install (unlike cache.addAll's all-or-nothing).
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
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
      // Drop every cache from an older build; keep the current assets + fonts.
      const keep = new Set([ASSET_CACHE, FONT_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// Serve from cache, fetching and filling on a miss. Used for fingerprinted
// assets, whose url changes on any content change — so a cached hit is never
// stale.
const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
};

// Serve the cached copy at once and refresh it in the background. Used for
// fonts, whose urls are stable across builds.
const staleWhileRevalidate = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // The API is always live; never serve it from a cache.
  if (url.pathname.startsWith("/api/")) return;
  if (url.protocol === "chrome-extension:") return;

  // Navigations: network-first, so a fresh shell (and its new asset hashes) wins
  // online; fall back to the cached shell offline (the PWA still opens).
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

  // Fonts (cross-origin, stable urls): stale-while-revalidate for offline text.
  if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
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

// A push arrives as the JSON the server encrypted (see server/util/notify.ts):
// { title, body, tag, url }. `tag` coalesces repeats of the same kind+day into
// one notification instead of stacking. userVisibleOnly subscriptions MUST show
// a notification for every push, so fall back to a generic one if the payload is
// missing or unparseable. The icon is the server-injected versioned url, so it
// busts when the icon changes.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    (async () => {
      // Let EVERY open tab refresh its store, focused or not — it's a data
      // store, so a backgrounded tab stays current in the background and is
      // fresh the instant you return to it. A visible tab also gives its bell a
      // quick, silent swing off this hand-off.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        client.postMessage({ type: "notification" });
      }
      // Only fire a system banner when nothing is on screen; a visible tab
      // handles it in-app. userVisibleOnly tolerates this focused-skip.
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

// Tapping a notification focuses an existing app window (navigating it to the
// target) or opens a new one.
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
        // Reuse an existing app window. On Android Chrome, navigate() hands back
        // a FRESH client handle; focusing the stale pre-navigation reference is
        // a silent no-op — the window navigates but never comes forward. Focus
        // whatever navigate() returns, falling back to the original handle.
        if ("navigate" in client && new URL(client.url).pathname !== url) {
          const navigated = await client.navigate(url).catch(() => null);
          return (navigated || client).focus();
        }
        return client.focus();
      }
      // App fully closed (no window client): launch it. On Android Chrome
      // openWindow can open the PWA at the right URL WITHOUT bringing it to the
      // foreground — the tap looks like it did nothing, the window sits in the
      // background on the target day, and only a manual open reveals it (the
      // reported "tap dismisses, PWA doesn't open"). Focus the opened window so
      // it actually comes forward.
      if (!self.clients.openWindow) return;
      const opened = await self.clients.openWindow(url).catch(() => null);
      if (opened && "focus" in opened) await opened.focus().catch(() => {});
    })(),
  );
});
