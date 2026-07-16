import { SHA } from "../../common/version.ts";
import { log } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";
import { logMap, routeOf } from "./beginLogger.ts";

const sizes = ["B", "KB", "MB", "GB", "TB"];

const prettySize = (size: number) => {
  if (Number.isNaN(size)) return "";

  let exp = 0;
  while (size >= 1024 && exp < sizes.length) {
    size /= 1024;
    exp++;
  }

  return Math.round(size) + sizes[exp];
};

export const endLogger: Handler = (req, _, prev) => {
  const data = logMap.get(req);

  // Stamp this process's build SHA on the way out so a running client can tell
  // it's older than the deploy now answering and reload (client reads it in
  // api.ts → store/version.ts). Every handled response carries it — the client
  // only reads it off API responses, but a blanket header is simplest and
  // harmless elsewhere. Guarded: a few responses (e.g. some static assets) come
  // back with immutable headers, where set() throws.
  if (prev) {
    try {
      prev.headers.set("x-blocktol-server-sha", SHA);
    } catch { /* immutable headers — skip */ }
  }

  const length = prev?.headers.get("content-length");

  log.info(req, "request finish", {
    method: req.method,
    status: prev?.status,
    route: routeOf(req),
    // Numeric ms (was "12ms") so it's aggregatable in VictoriaLogs.
    ms: data?.start ? Date.now() - data.start : undefined,
    size: typeof length === "string" ? prettySize(parseInt(length)) : undefined,
  });

  return prev;
};
