self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open("v1");
      await cache.addAll([
        "/",
        "/index.html",
        "/styles.css",
        "/js/index.js",
        "/favicon.svg",
        "/manifest.webmanifest",
      ]);
    })()
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    "navigationPreload" in self.registration
      ? self.registration.navigationPreload.enable()
      : Promise.resolve()
  );

  self.clients.claim();
});

// Static assets (icons, fonts) never change within a deploy, so serve them from
// cache and skip the network entirely. Without this the network-first path below
// re-fetches favicon.svg for every consumer (logo img, tab <link>, manifest) —
// and again on each render — flooding the network panel.
const CACHE_FIRST = /\.(?:svg|woff2?|ttf|png|ico|jpe?g|webp)$/;

const handleFetch = async (event) => {
  const cache = await caches.open("v1");

  if (CACHE_FIRST.test(new URL(event.request.url).pathname)) {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      cache.put(event.request, response.clone());
      return response;
    } catch {
      /* fall through to the shared cache lookup below */
    }
  }

  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) return preloadResponse;
  } catch {
    /* continue */
  }

  try {
    const response = await fetch(event.request);
    cache.put(event.request, response.clone());
    return response;
  } catch {
    /* continue */
  }

  return await cache.match(
    event.request.mode === "navigate" ? "/index.html" : event.request
  );
};

self.addEventListener("fetch", (event) => {
  if (event.request.url.match("/api/")) return;
  if (event.request.url.match("chrome-extension://")) return;

  event.respondWith(handleFetch(event));
});

// ---- Web Push ----

// A push arrives as the JSON the server encrypted (see server/util/notify.ts):
// { title, body, tag, url }. `tag` coalesces repeats of the same kind+day into
// one notification instead of stacking. userVisibleOnly subscriptions MUST show
// a notification for every push, so fall back to a generic one if the payload is
// missing or unparseable.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Blocktol";
  const options = {
    body: data.body || "",
    tag: data.tag,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
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
        if ("focus" in client) {
          if ("navigate" in client && new URL(client.url).pathname !== url) {
            await client.navigate(url).catch(() => {});
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
