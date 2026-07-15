import { log } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";

type LogData = {
  start: number;
};

export const logMap = new WeakMap<Request, LogData>();

// The request path (no origin), shared by the start/finish log lines.
export const routeOf = (req: Request) =>
  req.url.slice(new URL(req.url).origin.length);

export const beginLogger: Handler = (req, _, prev) => {
  logMap.set(req, { start: Date.now() });

  // Bookend the finish line (endLogger) with a start line, so a request that
  // hangs or dies mid-flight is still visible — the finish line only lands on
  // completion. This runs before extractUserId, so there's no userHash yet; pair
  // a start with its finish by the shared `trace_id` Deno's OTel stamps on both.
  log.info(req, "request start", { method: req.method, route: routeOf(req) });

  return prev;
};
