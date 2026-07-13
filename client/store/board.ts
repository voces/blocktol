import { api, MessageMap, primeFrom } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { todayIteration } from "./standings.ts";

// The client's normalized board store: one entry per iteration, fed by every
// board-shaped response (getBoard, startRun, the summary's resumed run), plus
// the loaders every board navigation goes through.
//
// The loaders exist for request identity. Responses broadcast through the api
// emitter can't be told apart — click day A then quickly day B and whichever
// response lands LAST used to stage the board, which may be A. Each loader
// instead consumes its own request's promise and stages only if no newer
// board request has been made since (a monotonic token). A placement's
// startRun also takes the token, so an in-flight re-stage from just before
// the placement can't clobber the freshly opened run.
//
// The cache makes re-navigation instant: a board we've seen stages
// synchronously (optimistically) and the response reconciles through the very
// same handler, so both paths maintain identical invariants.

// The staged-board shape: an iteration's fixed pieces and FULL budgets (what
// handleStaged expects), never the mid-run leftovers.
export type BoardData = Pick<
  // getBoard's soft mode can answer { incomplete } (a primed boot before the
  // daily's done); exclude it so the board shape stays a plain record here.
  Exclude<MessageMap["getBoard"], { incomplete: true }>,
  | "iteration"
  | "date"
  | "checkpoint"
  | "blocks"
  | "bricks"
  | "power"
  | "min"
  | "best"
  | "ownBest"
  | "attempts"
>;

// A board payload as run responses carry it: player blocks mixed in (some
// without a thunder field at all — the opening block) and the budgets already
// reduced by them.
type RunBoard = Omit<BoardData, "blocks"> & {
  blocks: { x: number; y: number; thunder?: boolean; player?: boolean }[];
};

// Normalize a response's board to the staged shape: strip player blocks and
// restore the full budget (remaining + already placed).
const toBoardData = (data: RunBoard): BoardData => {
  const placed = data.blocks.filter((b) => b.player);
  return {
    iteration: data.iteration,
    date: data.date,
    checkpoint: data.checkpoint,
    min: data.min,
    best: data.best,
    ownBest: data.ownBest,
    attempts: data.attempts,
    blocks: data.blocks
      .filter((b) => !b.player)
      .map(({ x, y, thunder }) => ({ x, y, thunder: !!thunder })),
    bricks: data.bricks + placed.length,
    power: data.power + placed.filter((b) => b.thunder).length,
  };
};

const boards = new Map<number, BoardData>();

export const getCachedBoard = (iteration: number) => boards.get(iteration);

// Upsert an iteration's board from any board-shaped response. Fixed pieces
// and budgets are stable per iteration; bests and attempts refresh with every
// response, so later ingests keep the entry current.
export const ingestBoard = (data: RunBoard) => {
  boards.set(data.iteration, toBoardData(data));
};

type Handlers = {
  // A run is live (started or resumed): stage its board mid-run.
  onRun: (data: MessageMap["startRun"]) => void;
  // Stage a runless free-play board. `data` is either a cache entry
  // (optimistic) or the fresh response reconciling it.
  onStaged: (data: BoardData) => void;
};

let handlers: Handlers = { onRun: () => {}, onStaged: () => {} };

// Wired by useInit on every render so the callbacks close over fresh state.
export const setBoardHandlers = (h: Handlers) => {
  handlers = h;
};

// Monotonic token: only the newest board request may stage.
let seq = 0;

/**
 * Claim the board token without issuing a request. Free play's first placement
 * opens a purely-local run (no startRun), so it must still take the token or an
 * in-flight re-stage fired just before the placement would land and clobber the
 * fresh build.
 */
export const claimBoard = () => {
  ++seq;
};

/**
 * The current board token. A deferred re-stage (free play awaiting its commit
 * before showing the next board) captures this and bails if it advanced — i.e.
 * the player navigated away while the commit was still landing.
 */
export const boardSeq = () => seq;

/**
 * Stage a board for free play (today's when `iteration` is omitted). A cached
 * iteration stages instantly; the response re-stages with fresh
 * bests/attempts. Resolves true if this request staged the board, false if a
 * newer request superseded it (or it failed) — callers chaining an overlay
 * (view-best) should skip it then.
 */
export const showBoard = (iteration?: number) => {
  const s = ++seq;
  const cached = iteration !== undefined ? boards.get(iteration) : undefined;
  if (cached) handlers.onStaged(cached);
  const req = () =>
    api.getBoard(
      iteration !== undefined
        ? { iteration, timeZone: getTimeZone() }
        : { timeZone: getTimeZone() },
    );
  const settle = (r: Awaited<ReturnType<typeof req>>) => {
    if ("error" in r || "incomplete" in r || s !== seq) {
      return s === seq && !!cached;
    }
    ingestBoard(r);
    handlers.onStaged(r);
    return true;
  };
  return req()
    .then((r) =>
      // A boot-primed soft board lands here as { incomplete } when the daily
      // wasn't finished at prime time. Discard it and fetch for real (the real
      // call sends no `soft`, so it can't come back incomplete) — this is what
      // keeps a stale prime from wedging the first true stage of the session.
      "incomplete" in r && s === seq ? req().then(settle) : settle(r)
    )
    .catch(() => !!cached && s === seq);
};

/**
 * Navigate to a specific day: its board AND its standings in ONE request
 * (`dayView`), then delegate to `showBoard` for the actual staging. A calendar
 * click / view-best used to fire getBoard (from showBoard) and standings
 * (the dock reacting to the iteration change) separately; this primes both off
 * one composite fetch under the exact inputs those two consumers send, so they
 * consume the slices instead of round-tripping again. It's boot, but for one
 * arbitrary chosen day.
 *
 * The standings input has to MATCH what the dock will send (see Dock.tsx): a day
 * that is today keys by { timeZone } (the dock treats it as today), a past day
 * by { iteration }. Both getBoard and standings are `RETRYABLE`, so a primed
 * response that fails at transport falls through to a real, retried fetch.
 */
export const showDay = (iteration: number) => {
  const timeZone = getTimeZone();
  const dv = api.dayView({ iteration, timeZone });
  primeFrom("getBoard", { iteration, timeZone }, dv, (r) => r.board);
  const standingsInput = iteration === todayIteration.value
    ? { timeZone }
    : { iteration };
  primeFrom("standings", standingsInput, dv, (r) => r.standings);
  return showBoard(iteration);
};

/**
 * Start (or open, for free play's first placement) a run. Resolves true if
 * this request's run took the board.
 */
export const startBoardRun = (
  iteration: number | "daily",
  block?: { x: number; y: number },
) => {
  const s = ++seq;
  return api.startRun({
    iteration,
    timeZone: getTimeZone(),
    ...(block ? { block } : {}),
  }).then((r) => {
    if ("error" in r || s !== seq) return false;
    ingestBoard(r);
    handlers.onRun(r);
    return true;
  }).catch(() => false);
};
