import { z } from "zod";
import { getOwnBestMaze } from "../../db/user.ts";
import { method } from "../apiHelpers.ts";

const getOwnBestMazeBody = z.object({
  iteration: z.number().min(1),
});

export const best = method(getOwnBestMazeBody, true)(
  async ({ userId, iteration }) => {
    const maze = await getOwnBestMaze(userId, iteration) ?? [];

    return { maze };
  },
);
