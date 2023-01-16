import { serveFile } from "std/http/file_server.ts";
import { join, normalize } from "std/path/posix.ts";
import { Handler } from "../util/Router.ts";

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
