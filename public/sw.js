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
