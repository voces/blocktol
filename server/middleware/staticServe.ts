import { serveFile } from "@std/http/file-server";
import { join, normalize } from "@std/path/posix";
import { assets } from "../util/assets.ts";
import type { Handler } from "../util/Router.ts";

// The shell / SW / manifest are precomputed (with `?v=` stamps injected) and
// served no-cache, so a new asset hash reaches the client on its next visit.
const noCache = (body: string, contentType: string) =>
  new Response(body, {
    headers: { "content-type": contentType, "cache-control": "no-cache" },
  });

// Serve the SPA shell for a client-routed path such as the `/YYYYMMDD`
// permalink. Register ahead of staticServe, which passes a prior response
// through.
export const serveApp = (publicDir: string): Handler => async () => {
  const { shell } = await assets(publicDir);
  return noCache(shell, "text/html; charset=utf-8");
};

export const staticServe =
  (publicDir: string): Handler => async (req, _, prev) => {
    if (prev) return prev;

    const url = new URL(req.url);
    // A malformed escape (`/%E0%A4%A`) makes decodeURI throw: a 400, not the
    // router's 500 + error log.
    let decoded: string;
    try {
      decoded = decodeURI(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const pathname = normalize(decoded);
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
      // A correctly versioned asset (`?v=<current hash>`, file unchanged since
      // this process hashed it) is immutable for a year; anything else keeps
      // serveFile's revalidating ETag default.
      const cc = a.cacheControlFor(pathname, url.searchParams, stat.mtime);
      if (cc) res.headers.set("cache-control", cc);
      return res;
    } catch { /* not found — fall through to the next handler */ }
  };
