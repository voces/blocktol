import { z } from "zod";

import { listDailies } from "../../db/user.ts";
import { getUserId } from "../../middleware/userid.ts";
import { method } from "../apiHelpers.ts";

// [year, month (1-12), day (1-31)]. Bounds a calendar window; omit both for the
// current month.
const day = z.tuple([
  z.number().int(),
  z.number().int().min(1).max(12),
  z.number().int().min(1).max(31),
]);

const listIterationsBody = z.union([
  z.object({
    start: day.optional(),
    end: day.optional(),
  }),
  z.void(),
  z.undefined(),
]);

export const listIterations = method(listIterationsBody)(
  async (input, req) => {
    const userId = getUserId(req);
    if (userId instanceof Error) return { error: userId, status: 401 };
    const { items, oldest } = await listDailies(userId, {
      start: input?.start,
      end: input?.end,
    });
    return { kind: "list", items, oldest };
  },
);
