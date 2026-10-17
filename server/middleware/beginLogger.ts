import { SHA } from "../../common/version.ts";
import { log } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";

type LogData = {
  start: number;
};

export const logMap = new WeakMap<Request, LogData>();

// A sign-in link's path segment IS the bearer credential (`/l/<id>`,
// `/login/<id>` — see routes/loginLink.ts), and these routes run before
// extractUserId, so nothing hashes it first. Redact the segment (and anything
// after it, query included) before a path reaches a log line: VictoriaLogs is
// readable without the credential, so the raw id must never land there.
const LOGIN_LINK = /^\/(l|login)\/[^?#]*(?:[?#].*)?$/;

export const redactPath = (path: string) => path.replace(LOGIN_LINK, "/$1/:id");

// The request path (no origin), shared by the start/finish log lines, with any
// sign-in credential redacted.
export const routeOf = (req: Request) =>
  redactPath(req.url.slice(new URL(req.url).origin.length));

export const beginLogger: Handler = (req, _, prev) => {
  logMap.set(req, { start: Date.now() });

  // Bookend the finish line (endLogger) with a start line, so a request that
  // hangs or dies mid-flight is still visible — the finish line only lands on
  // completion. This runs before extractUserId, so there's no userHash yet; pair
  // a start with its finish by the shared `trace_id` Deno's OTel stamps on both.
  //
  // Both build SHAs ride the start line: `serverSha` is this process's build
  // (which deploy served the request — SHA from common/version.ts), and
  // `clientSha` is the caller's bundle (the header the client sends — see
  // client/api.ts). When they differ the caller is on a stale bundle, which is
  // exactly the skew that drives the client's stale-reload. `clientSha` is
  // absent on non-API requests / legacy clients, where the field drops out.
  log.info(req, "request start", {
    method: req.method,
    route: routeOf(req),
    serverSha: SHA,
    clientSha: req.headers.get("x-blocktol-client-sha") ?? undefined,
  });

  return prev;
};
