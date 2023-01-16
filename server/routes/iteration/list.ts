import { z } from "zod";

import { listDailies } from "../../db/user.ts";
import { getUserId } from "../../middleware/userid.ts";
import { method } from "../apiHelpers.ts";

const listIterationsBody = z.union([
  z.object({
    page: z.number().min(1).optional(),
    size: z.number().min(1).max(100).optional(),
  }),
  z.void(),
  z.undefined(),
]);

export const listIterations = method(listIterationsBody)(
  async ({ page = 1, size = 100 } = {}, req) => {
    const userId = getUserId(req);
    if (userId instanceof Error) return { error: userId, status: 401 };
    return {
      kind: "list",
      items: await listDailies(userId, size, (page - 1) * size),
    };
  },
);
