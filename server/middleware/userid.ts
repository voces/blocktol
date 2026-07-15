import { trace } from "@opentelemetry/api";
import { hashUserId } from "../util/hashUserId.ts";
import { setLoggingContext } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";
import { UserError } from "../util/UserError.ts";

export class AuthError extends UserError {}

const userIdContext = new WeakMap<Request, string>();

export const extractUserId: Handler = async (req, _, prev) => {
  const userId = req.headers.get("authorization");
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
