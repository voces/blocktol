self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open("v1");
      await cache.addAll([
        "/",
        "/index.html",
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

const handleFetch = async (event) => {
  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) return preloadResponse;
  } catch {
    /* continue */
  }

  try {
    return await fetch(event.request);
  } catch {
    /* continue */
  }

  const cache = await caches.open("v1");
  return await cache.match(
    event.request.mode === "navigate" ? "/index.html" : event.request
  );
};

self.addEventListener("fetch", (event) => {
  if (event.request.url.match("/api/")) return;

  event.respondWith(handleFetch(event));
});
