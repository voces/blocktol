import { trace } from "@opentelemetry/api";
import { hashUserId } from "../util/hashUserId.ts";
import { log, setLoggingContext } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";
import { UserError } from "../util/UserError.ts";

export class AuthError extends UserError {}

const userIdContext = new WeakMap<Request, string>();

// The shape every id ever minted has: `user.id` is char(36), and the client has
// generated 36-char UUIDs, then 32-char base36 pairs, then 13-char base36 —
// all lowercase alphanumerics and hyphens (the very first client's 1024-char
// printable id could never match a char(36) row, and an early client replaced
// any non-UUID id it found). Tests
// use `t-<hex>`. Upper case and `_` are admitted only as harmless slack. A
// header outside this is treated exactly like a missing one — anonymous, so
// authed methods 401 — rather than letting arbitrary text (quotes, backticks,
// newlines, kilobytes) flow on into SQL params, hashing, and admin alerts.
const USER_ID = /^[A-Za-z0-9_-]{1,36}$/;

export const extractUserId: Handler = async (req, _, prev) => {
  const header = req.headers.get("authorization");
  const userId = header && USER_ID.test(header) ? header : null;
  if (header && !userId) {
    // Never the value itself — it may be a real credential that's merely
    // mangled. The length is enough to tell a proxy's `Bearer …` from junk.
    log.warn(req, "malformed authorization header", { length: header.length });
  }
  if (userId) {
    // The raw id stays in-memory for handlers (it's the credential they authorize
    // with); logs get only its hash — the request log flows to VictoriaLogs, which
    // is readable without that credential, so the raw value must not ride along.
    userIdContext.set(req, userId);
    const userHash = await hashUserId(userId);
    setLoggingContext(req, (c) => ({ ...c, userHash }));
    // Colour the request span with the same hashed tag, so a trace can be
    // filtered to one player without the raw credential ever touching telemetry.
    // No-ops when OTel is off (no active span) — e.g. the Deno Deploy instance.
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
