import { z } from "zod";
import { coerceFlat, log } from "../util/logging.ts";
import { method } from "./apiHelpers.ts";

// This endpoint is unauthenticated (a crash can predate any identity), so its
// body is fully untrusted. Bound `message` so a caller can't flood the log sink
// with multi-MB lines; logfmt injection is already handled downstream — the
// logger JSON-quotes any value containing whitespace, so an embedded newline
// can't forge a second field (see util/logging.ts `encode`). A real client
// error message / stack is well under 2000 chars.
const reportClientErrorBody = z.object({
  message: z.string().max(2000),
  data: z.record(z.unknown()).optional(),
});

// Client-side crashes, relayed here so they land in VictoriaLogs alongside server
// errors (Deno's OTel captures this console.error) rather than only in the
// browser. The request's logging context already carries the hashed user id
// (extractUserId), so the log line is attributable without shipping anything else.
// `data.error` is the stack/message the client lifted from the caught value.
export const reportClientError = method(reportClientErrorBody)(
  ({ message, data }, req) => {
    log.error(req, `client error: ${message}`, coerceFlat(data ?? {}));
    return {};
  },
);
