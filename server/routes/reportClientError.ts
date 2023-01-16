import { z } from "https://deno.land/x/zod@v3.20.2/index.ts";
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
