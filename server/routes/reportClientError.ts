import { z } from "zod";
import { coerceFlat, log, type LogFields } from "../util/logging.ts";
import { method } from "./apiHelpers.ts";

// This endpoint is unauthenticated (a crash can predate any identity), so its
// body is fully untrusted. Bound `message` so a caller can't flood the log sink
// with multi-MB lines; logfmt injection is already handled downstream — the
// logger JSON-quotes any value containing whitespace, so an embedded newline
// can't forge a second field (see util/logging.ts `encode`). A real client
// error message / stack is well under 2000 chars.
//
// `data` is bounded the same way: at most MAX_KEYS fields, each value cut to
// MAX_VALUE chars AFTER stringification (an object value only becomes long once
// coerceFlat serialises it). Its keys are namespaced `client.` so a payload
// can't override the request context the log line is merged with — a client
// sending `userHash` would otherwise overwrite the real hashed id
// (logging.ts lets call fields win over context).
const MAX_KEYS = 20;
const MAX_VALUE = 4000;

const reportClientErrorBody = z.object({
  message: z.string().max(2000),
  data: z.record(z.unknown()).refine((d) => Object.keys(d).length <= MAX_KEYS, {
    message: `at most ${MAX_KEYS} fields`,
  }).optional(),
});

export const clientFields = (data: Record<string, unknown>): LogFields => {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(coerceFlat(data))) {
    out[`client.${k}`] = typeof v === "string" && v.length > MAX_VALUE
      ? v.slice(0, MAX_VALUE) + "…"
      : v;
  }
  return out;
};

// Client-side crashes, relayed here so they land in VictoriaLogs alongside server
// errors (Deno's OTel captures this console.error) rather than only in the
// browser. The request's logging context already carries the hashed user id
// (extractUserId), so the log line is attributable without shipping anything else.
// `client.error` is the stack/message the client lifted from the caught value.
export const reportClientError = method(reportClientErrorBody)(
  ({ message, data }, req) => {
    log.error(req, `client error: ${message}`, clientFields(data ?? {}));
    return {};
  },
);
