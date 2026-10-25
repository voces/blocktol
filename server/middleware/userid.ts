import { trace } from "@opentelemetry/api";
import { hashUserId } from "../util/hashUserId.ts";
import { log, setLoggingContext } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";
import { UserError } from "../util/UserError.ts";

export class AuthError extends UserError {}

const userIdContext = new WeakMap<Request, string>();

// The shape of every id ever minted: `user.id` is char(36) and clients have
// generated lowercase alphanumerics and hyphens (UUIDs, then shorter base36).
// Tests use `t-<hex>`. Upper case and `_` are harmless slack. A header outside
// this is treated like a missing one (anonymous, so authed methods 401), so
// arbitrary text never flows into SQL params, hashing or admin alerts.
const USER_ID = /^[A-Za-z0-9_-]{1,36}$/;

export const extractUserId: Handler = async (req, _, prev) => {
  const header = req.headers.get("authorization");
  const userId = header && USER_ID.test(header) ? header : null;
  if (header && !userId) {
    // Length only: the value may be a mangled real credential. Enough to tell
    // a proxy's `Bearer …` from junk.
    log.warn(req, "malformed authorization header", { length: header.length });
  }
  if (userId) {
    // The raw id stays in memory for handlers (`getUserId`); logs and spans get
    // only its hash, since VictoriaLogs/Traces are readable without it.
    userIdContext.set(req, userId);
    const userHash = await hashUserId(userId);
    setLoggingContext(req, (c) => ({ ...c, userHash }));
    // Tag the request span with the hash to filter a trace to one player.
    // No-ops when OTel is off (e.g. a local run).
    trace.getActiveSpan()?.setAttribute("user.hash", userHash);
  }
  return prev;
};

export const getUserId = (req: Request) => {
  const userId = userIdContext.get(req);
  if (!userId) return new AuthError("No authorization for request");
  return userId!;
};

export const getUserIdMaybe = (req: Request) => userIdContext.get(req);
