import { serveFile } from "@std/http/file-server";
import { join, normalize } from "@std/path/posix";
import { assets } from "../util/assets.ts";
import { Handler } from "../util/Router.ts";

// The shell / SW / manifest are precomputed (with `?v=` stamps injected) and
// served no-cache, so a new asset hash always reaches the client on the next
// visit. Fingerprinted assets carry their own year-long immutable cache.
const noCache = (body: string, contentType: string) =>
  new Response(body, {
    headers: { "content-type": contentType, "cache-control": "no-cache" },
  });

// Serve the SPA shell (index.html) for a client-routed path — e.g. the
// `/YYYYMMDD` day permalink, which isn't a real file. Registered ahead of
// staticServe so the file server passes its response through.
export const serveApp = (publicDir: string): Handler => async () => {
  const { shell } = await assets(publicDir);
  return noCache(shell, "text/html; charset=utf-8");
};

export const staticServe =
  (publicDir: string): Handler => async (req, _, prev) => {
    if (prev) return prev;

    const url = new URL(req.url);
    const pathname = normalize(decodeURI(url.pathname));
    const a = await assets(publicDir);

    // The versioned shell / SW / manifest, served from memory no-cache.
    if (pathname === "/" || pathname === "/index.html") {
      return noCache(a.shell, "text/html; charset=utf-8");
    }
    if (pathname === "/sw.js") {
      return noCache(a.sw, "text/javascript; charset=utf-8");
    }
    if (pathname === "/manifest.webmanifest") {
      return noCache(a.manifest, "application/manifest+json; charset=utf-8");
    }

    const path = join(Deno.cwd(), publicDir, pathname);
    try {
      const stat = await Deno.stat(path);
      if (stat.isDirectory) {
        return await serveFile(req, join(path, "index.html"));
      }
      const res = await serveFile(req, path);
      // A correctly-versioned asset (`?v=<current hash>`) is immutable for a
      // year; anything else keeps serveFile's revalidating ETag default.
      const cc = a.cacheControlFor(pathname, url.searchParams);
      if (cc) res.headers.set("cache-control", cc);
      return res;
    } catch { /* not found — fall through to the next handler */ }
  };
