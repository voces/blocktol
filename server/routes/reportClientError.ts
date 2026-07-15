import { z } from "zod";
import { hashUserId } from "../util/hashUserId.ts";
import { log } from "../util/logging.ts";
import { reportError } from "../util/newrelic.ts";
import { getUserIdMaybe } from "../middleware/userid.ts";
import { method } from "./apiHelpers.ts";

const reportClientErrorBody = z.object({
  message: z.string(),
  data: z.record(z.unknown()).optional(),
});

export const reportClientError = method(reportClientErrorBody)(
  async ({ message, data }, req) => {
    log.error(req, `client error: ${message}`, data);
    // Relay to NewRelic so client crashes are visible alongside server errors
    // rather than only in this request's Deploy log. `data.error` (a stack or
    // message the client lifted from the caught value) feeds the Errors Inbox.
    const userId = getUserIdMaybe(req);
    reportError({
      source: "client",
      message,
      error: data?.error,
      // Hashed, never the raw credential — this ships to New Relic (see hashUserId).
      attributes: {
        ...data,
        userHash: userId ? await hashUserId(userId) : undefined,
      },
    });
    return {};
  },
);
