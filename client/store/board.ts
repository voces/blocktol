import { api, type MessageMap, primeFrom } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { todayIteration } from "./standings.ts";

// The client's normalized board store: one entry per iteration, fed by every
// board-shaped response (getBoard, startRun, the summary's resumed run), plus
// the loaders every board navigation goes through.
//
// The loaders exist for request identity. Responses broadcast through the api
// emitter can't be told apart: click day A then day B and whichever response
// lands LAST stages the board, which may be A. Each loader consumes its own
// request's promise and stages only if no newer board request has been made
// since (a monotonic token). A placement's startRun also takes the token, so an
// in-flight re-stage can't clobber the freshly opened run.
//
// A cached board stages synchronously and the response reconciles through the
// same handler, so both paths keep the same invariants.

// The staged-board shape: an iteration's fixed pieces and FULL budgets (what
// handleStaged expects), never the mid-run leftovers.
export type BoardData = Pick<
  // getBoard answers { incomplete } while free play is locked; exclude it.
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

// A board payload as run responses carry it: player blocks mixed in (the
// opening block has no thunder field) and the budgets already reduced by them.
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

// Upsert an iteration's board from any board-shaped response. Fixed pieces and
// budgets are stable per iteration; bests and attempts refresh every ingest.
export const ingestBoard = (data: RunBoard) => {
  boards.set(data.iteration, toBoardData(data));
};

type Handlers = {
  // A run is live (started or resumed): stage its board mid-run.
  onRun: (data: MessageMap["startRun"]) => void;
  // Stage a runless free-play board: a cache entry or the response reconciling
  // it.
  onStaged: (data: BoardData) => void;
};

let handlers: Handlers = { onRun: () => {}, onStaged: () => {} };

// Wired by useInit on every render so the callbacks see fresh state.
export const setBoardHandlers = (h: Handlers) => {
  handlers = h;
};

// Monotonic token: only the newest board request may stage.
let seq = 0;

/**
 * Claim the board token without issuing a request. Free play's first placement
 * opens a local run (no startRun) but must still take the token, or an
 * in-flight re-stage would clobber the fresh build.
 */
export const claimBoard = () => {
  ++seq;
};

/**
 * The current board token. A deferred re-stage (free play awaiting its commit)
 * captures this and bails if it advanced, i.e. the player navigated away.
 */
export const boardSeq = () => seq;

/**
 * Stage a board for free play (today's when `iteration` is omitted). A cached
 * iteration stages instantly; the response re-stages with fresh bests and
 * attempts. Resolves true if this request left the board staged (the cache
 * entry counts when the response fails), false if a newer request superseded
 * it. Callers chaining an overlay (view-best) skip it on false.
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
      // { incomplete } from a PRIMED response may date from boot, several
      // attempts ago (e.g. the linked-day prime of a `/YYYYMMDD`-for-today
      // boot). Ask again so a stale prime can't wedge the stage. A genuinely
      // locked board answers { incomplete } twice and doesn't stage; useInit
      // owns that screen.
      "incomplete" in r && s === seq ? req().then(settle) : settle(r)
    )
    .catch(() => !!cached && s === seq);
};

/**
 * Navigate to a specific day: its board AND its standings in ONE request
 * (`dayView`), then stage via `showBoard`. The one composite fetch primes the
 * getBoard (from showBoard) and standings (from the dock) requests that would
 * otherwise go out separately.
 *
 * The standings input has to MATCH what the dock sends (see Dock.tsx): today
 * keys by { timeZone }, a past day by { iteration }. Both methods are
 * `RETRYABLE`, so a primed response that fails at transport falls through to a
 * retried fetch.
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

// A ranked Start whose answer never arrived (see startDailyRun): the ranked
// attempts spent when it was pressed, held while the re-check is in flight. The
// getDailySummary listener (useInit) takes it, since the api emitter hands it
// the response before startDailyRun sees it, and resumes the open attempt when
// the server has one more ranked run than that.
let lostStart: number | null = null;
export const takeLostStart = () => {
  const spent = lostStart;
  lostStart = null;
  return spent;
};

/**
 * The prestart's Start: open today's ranked attempt. `spent` is how many ranked
 * attempts were already used. Resolves true if this request's attempt took the
 * board, including one recovered after a lost answer, so the button stays down;
 * false re-enables it.
 *
 * startRun isn't retryable (it spends an attempt), and a transport failure may
 * mean the server inserted the run and only the reply was lost; re-enabling the
 * button would let a second press burn another attempt. So on a transport
 * failure, ask the summary: an open attempt AND one more ranked run than
 * `spent` means it is ours, and the summary listener resumes it. The count
 * matters: the PREVIOUS attempt's 60s window can still be open just after it
 * executed and must not be mistaken for the new one.
 */
export const startDailyRun = async (spent: number) => {
  const s = ++seq;
  try {
    const r = await api.startRun({
      iteration: "daily",
      timeZone: getTimeZone(),
    });
    if ("error" in r || s !== seq) return false;
    ingestBoard(r);
    handlers.onRun(r);
    return true;
  } catch {
    if (s !== seq) return false;
  }
  lostStart = spent;
  try {
    const r = await api.getDailySummary({ timeZone: getTimeZone() });
    return !("error" in r) && !!r.currentRun && r.ranked.length > spent;
  } catch {
    return false;
  } finally {
    lostStart = null;
  }
};
