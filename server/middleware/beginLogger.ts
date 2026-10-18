import { SHA } from "../../common/version.ts";
import { log } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";

type LogData = {
  start: number;
};

export const logMap = new WeakMap<Request, LogData>();

// A legacy sign-in link's path segment IS the bearer credential (`/l/<id>`,
// `/login/<id>`; routes/loginLink.ts) and those routes run before
// extractUserId, so nothing hashes it. Redact it (and anything after, query
// included) before a path reaches a log line; VictoriaLogs is readable without
// the credential.
const LOGIN_LINK = /^\/(l|login)\/[^?#]*(?:[?#].*)?$/;

export const redactPath = (path: string) => path.replace(LOGIN_LINK, "/$1/:id");

// The request path (no origin) for the start/finish log lines, redacted.
export const routeOf = (req: Request) =>
  redactPath(req.url.slice(new URL(req.url).origin.length));

export const beginLogger: Handler = (req, _, prev) => {
  logMap.set(req, { start: Date.now() });

  // A start line precedes endLogger's finish line so a request that hangs or
  // dies mid-flight is still visible. This runs before extractUserId, so there
  // is no userHash yet; pair the two lines by the shared `trace_id`.
  //
  // `serverSha` is this process's build (common/version.ts); `clientSha` is the
  // caller's bundle (client/api.ts), absent on non-API requests and legacy
  // clients. A mismatch is the skew that drives the client's stale-reload.
  log.info(req, "request start", {
    method: req.method,
    route: routeOf(req),
    serverSha: SHA,
    clientSha: req.headers.get("x-blocktol-client-sha") ?? undefined,
  });

  return prev;
};
