import { serveFile } from "@std/http/file-server";
import { join, normalize } from "@std/path/posix";
import { Handler } from "../util/Router.ts";

// Serve the SPA shell (index.html) for a client-routed path — e.g. the
// `/YYYYMMDD` day permalink, which isn't a real file. Registered ahead of
// staticServe so the file server passes its response through.
export const serveApp = (publicDir: string): Handler => (req) =>
  serveFile(req, join(Deno.cwd(), publicDir, "index.html"));

export const staticServe =
  (publicDir: string): Handler => async (req, _, prev) => {
    if (prev) return prev;

    const path = join(
      Deno.cwd(),
      ...(typeof publicDir === "string" ? [publicDir] : publicDir),
      normalize(decodeURI(new URL(req.url).pathname)),
    );

    try {
      return (await Deno.stat(path)).isDirectory
        ? serveFile(req, join(path, "index.html"))
        : serveFile(req, path);
    } catch { /* do nothing */ }
  };
