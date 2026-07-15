import { z } from "zod";
import { log } from "../util/logging.ts";
import { method } from "./apiHelpers.ts";

const reportClientErrorBody = z.object({
  message: z.string(),
  data: z.record(z.unknown()).optional(),
});

// Client-side crashes, relayed here so they land in VictoriaLogs alongside server
// errors (Deno's OTel captures this console.error) rather than only in the
// browser. The request's logging context already carries the hashed user id
// (extractUserId), so the log line is attributable without shipping anything else.
// `data.error` is the stack/message the client lifted from the caught value.
export const reportClientError = method(reportClientErrorBody)(
  ({ message, data }, req) => {
    log.error(req, `client error: ${message}`, data);
    return {};
  },
);
