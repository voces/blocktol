import { z } from "zod";
import { log } from "../util/logging.ts";
import { method } from "./apiHelpers.ts";

const reportClientErrorBody = z.object({
  message: z.string(),
  data: z.record(z.unknown()).optional(),
});

export const reportClientError = method(reportClientErrorBody)(
  ({ message, data }, req) => {
    log.error(req, `client error: ${message}`, data);
    return {};
  },
);
