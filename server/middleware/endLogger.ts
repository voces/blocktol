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
