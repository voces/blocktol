import { z } from "zod";
import { coerceFlat, log, type LogFields } from "../util/logging.ts";
import { method } from "./apiHelpers.ts";

// Unauthenticated (a crash can predate any identity), so the body is untrusted.
// `message` is capped so a caller can't flood the log sink; logfmt injection is
// handled by `encode` in util/logging.ts.
//
// `data` is capped at MAX_KEYS fields, each value cut to MAX_VALUE chars AFTER
// stringification (`coerceFlat` is what serialises an object value). Keys are
// namespaced `client.` because call fields win over request context in
// logging.ts: a client-sent `userHash` would otherwise overwrite the real one.
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

// Client crashes, relayed so they land in VictoriaLogs beside server errors.
// The request's logging context already carries the hashed user id
// (extractUserId). `client.error` is the stack/message the client lifted from
// the caught value.
export const reportClientError = method(reportClientErrorBody)(
  ({ message, data }, req) => {
    log.error(req, `client error: ${message}`, clientFields(data ?? {}));
    return {};
  },
);
