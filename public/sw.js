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

  const cache = await caches.open("v1");

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
