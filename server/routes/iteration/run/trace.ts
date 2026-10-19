import { z } from "zod";
import {
  TRACE_BATCH_MAX,
  type TraceBatch,
} from "../../../../common/runTrace.ts";
import { coord } from "./piece.ts";

// A ranked save's edit batch (common/runTrace.ts). Parsed apart from the save's
// body schema, by `parseTraceBatch`: a malformed trace must never fail the save
// itself, which would revert a real edit over data only review reads.
const index = z.number().int().min(0);
// An hour bounds a batch held through a long offline retry; past it the event
// is noise.
const age = z.number().int().min(0).max(3_600_000);

const traceEvent = z.union([
  z.tuple([index, age, z.enum(["p", "d", "u"]), coord, coord]),
  z.tuple([index, age, z.literal("m"), coord, coord, coord, coord]),
]);

const traceBatch = z.object({
  // Names the page that recorded it; `(p, i)` dedupes a resent batch.
  p: z.string().regex(/^[A-Za-z0-9]{1,16}$/),
  e: z.array(traceEvent).max(TRACE_BATCH_MAX),
});

// The batch, or undefined for a client that sent none or one that doesn't
// parse. Either way the save still records its line, so a trace-less ranked
// save is itself visible in review.
export const parseTraceBatch = (raw: unknown): TraceBatch | undefined => {
  if (raw === undefined) return undefined;
  const r = traceBatch.safeParse(raw);
  return r.success ? r.data : undefined;
};

// The line updateCurrentRun appends, minus the `{"s":` the SQL prefixes:
// pieces saved (`n`), the maze's path time (`d`), and the batch if there is
// one. A line without `p` is a save that carried no usable trace.
export const traceLine = (
  pieces: number,
  duration: number,
  batch: TraceBatch | undefined,
) => JSON.stringify({ n: pieces, d: duration, ...batch }).slice(1) + "\n";
