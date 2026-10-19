import { z } from "zod";
import {
  getIteration,
  getIterationOtherBest as getIterationOtherBestRaw,
} from "../../../db/iteration.ts";
import { getLatestRun, updateCurrentRun } from "../../../db/run.ts";
import { onPbBuild } from "../../../util/pbBoard.ts";
import { errText, log } from "../../../util/logging.ts";
import { boundedTrailer } from "../../../util/memoize.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { method } from "../../apiHelpers.ts";
import { piece } from "./piece.ts";
import { parseTraceBatch, traceLine } from "./trace.ts";

// Whether a save commits (ranked) or stays void until execution (free play) is
// derived in updateCurrentRun from the run itself; the body has no freePlay
// flag (zod strips one from a cached client).
const updateRunBody = z.object({
  iteration: z.number(),
  // The 18×18 interior is 324 cells, so no legal maze has more pieces. Cap at
  // 400 so zod rejects an oversized array before validateRun walks it.
  blocks: z.array(piece).max(400),
  // The edits since the last confirmed save (common/runTrace.ts), parsed
  // leniently by parseTraceBatch so a bad trace can't fail the save.
  trace: z.unknown().optional(),
});

// Stale-while-revalidate per (iteration, user), so a burst of saves doesn't
// re-run the field query. Bounded (`boundedTrailer`) because the process is
// long-lived; 10k keys covers every concurrent builder, and an evicted key just
// refetches on its next save.
const getIterationOtherBest = boundedTrailer(getIterationOtherBestRaw, 10_000);

export const updateRun = method(updateRunBody, true)(
  async ({ iteration: iterationId, blocks, trace, userId }, req) => {
    let iteration: Awaited<ReturnType<typeof getIteration>>;
    // The best build among other players (void excluded): the mark to beat to
    // lead the field, for both `supreme` and the onPbBuild gate below.
    let otherBest: number | null;
    try {
      [iteration, otherBest] = await Promise.all([
        getIteration(iterationId),
        getIterationOtherBest(iterationId, userId)(),
      ]);
    } catch (err) {
      log.error(req, "invalid iteration", { error: errText(err) });
      return { error: "invalid iteration", status: 400 };
    }

    const validation = validateRun(iteration, blocks);
    if (!validation.ok) {
      // A caller with no run here (every run row passes the board gate in
      // startRun) gets `expired`, as a legal save would. Echoing validateRun's
      // reason would be an oracle on a board they can't see: "invalid path"
      // maps the fixed pieces one probe at a time, "too many blocks" the
      // budget.
      if (!(await getLatestRun(userId, iterationId))) {
        return { expired: true as const };
      }
      return { error: validation.reason, status: 400 };
    }
    const { path, duration, slows } = validation;

    // Awaited: a Deno Deploy preview kills a write still pending after the
    // response.
    try {
      const { saved } = await updateCurrentRun(
        userId,
        duration,
        blocks.map((b) => ({ ...b, player: true })),
        iterationId,
        traceLine(blocks.length, duration, parseTraceBatch(trace)),
      );
      // The 60s window closed before this save (or no current run): the edit
      // was NOT persisted. Success-shaped, not an error, so the client doesn't
      // report it; it reverts its optimistic edit to the last accepted maze.
      if (!saved) return { expired: true as const };
    } catch (err) {
      log.error(req, "failed to save run", { error: errText(err) });
      return { error: "failed to save run", status: 500 };
    }

    // A ranked build enters the PB field like free play. When it reaches the
    // field top, onPbBuild sends lost-top notifications and the Discord top-PB
    // post/edit; it re-validates and dedupes, so a stream of leading saves
    // notifies once. The gate includes an exact TIE (>=) and the first build of
    // the day (otherBest == null): both can set or match the record though
    // decideLostTop stays silent on them. Awaited because a Deploy preview
    // kills work left running after the response; never throws.
    //
    // Known edge: this fires per save, not at finalization, so a build can
    // reach the top, fire the card/post, then be trimmed back below it before
    // the 60s window closes, leaving a stale "lost #1" or record post. Rare and
    // low-harm (deduped to one card that deep-links to live standings).
    // Deferring to finalization needs a cancelable one-off scheduler, and
    // neither `setTimeout` (dies with a preview isolate) nor hourly `Deno.cron`
    // is one. Free play fires once at execution (commitRun), so it has no such
    // edge.
    if (otherBest == null || duration >= otherBest) {
      await onPbBuild(iterationId, userId);
    }

    return { path, duration, slows, supreme: duration > (otherBest ?? 0) };
  },
);
