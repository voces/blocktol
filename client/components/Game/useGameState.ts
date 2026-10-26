import { createContext } from "preact";
import { useMemo, useRef, useState } from "preact/compat";
import { newGrid } from "../../../common/pathing.ts";
import { type Point } from "../../../common/types.ts";
import { type MessageMap } from "../../api.ts";
import { localRun, mazeBudget } from "./helpers.ts";
import {
  type BoardBlock,
  clearTouchZoom,
  dragMoved,
  invalid,
  placingBlock,
  thunderHover,
  transitionBlock,
} from "./interaction.ts";
import { type Verdict } from "./verdict.ts";

// The board's mode: one name for what the sentinels (time / staged / viewing /
// run) encode together. Derived, not enforced; writers still set the
// primitives.
export type BoardPhase =
  | "loading" // nothing fetched yet (boot)
  | "prestart" // a daily attempt is ready but unstarted (Start attempt overlay)
  | "viewing" // static review of a past maze (Play button)
  | "staged" // free play before the opening placement (clock frozen)
  | "building" // a run's build window is counting down
  | "running" // the runner is animating
  | "idle"; // between a finished run and the next board

export const GameStateContext = createContext<
  ReturnType<typeof useGameState>
>(
  new Proxy({}, {
    get: () => {
      throw new Error("Expected context provider");
    },
    // oxlint-disable-next-line typescript/no-explicit-any
  }) as any,
);

export const useGameState = () => {
  // The local block grabbed for a drag, if any. `startX/startY` is the pressed
  // cell, `startClientX/Y` the press point in screen pixels. `dragged` sticks
  // true only once the pointer leaves the cell AND travels past a small pixel
  // slop, so a tap, jitter, or the placing zoom's shift under a held finger
  // doesn't nudge the block.
  const dragRef = useRef<
    | {
      origin: Point & { local?: boolean; thunder?: boolean; active?: boolean };
      dragged: boolean;
      startX: number;
      startY: number;
      startClientX: number;
      startClientY: number;
    }
    | null
  >(null);
  // True while a fresh-block placement press is in progress (an empty cell,
  // not a grabbed block), so the hover logic shows the preview over any block
  // as invalid (red) rather than as the tap-to-upgrade preview. Cleared on
  // release.
  const placingRef = useRef(false);
  const [checkpoint, _setCheckpoint] = useState<Point>({ x: -2, y: -2 });
  const [blocks, _setBlocks] = useState<ReadonlyArray<BoardBlock>>([]);
  // Mirrors of the board, like the budgets' (below). `viewMaze` callers (the
  // today-result chips, the profile's view-best) stage another day and overlay
  // the maze in a `.then`, so the board in their closure is the day they left.
  // `viewMaze` needs the CURRENT fixed pieces and checkpoint.
  const blocksRef = useRef<ReadonlyArray<BoardBlock>>(blocks);
  const checkpointRef = useRef(checkpoint);
  const setBlocks: typeof _setBlocks = (b) => {
    blocksRef.current = typeof b === "function" ? b(blocksRef.current) : b;
    _setBlocks(b);
  };
  const setCheckpoint: typeof _setCheckpoint = (c) => {
    checkpointRef.current = typeof c === "function"
      ? c(checkpointRef.current)
      : c;
    _setCheckpoint(c);
  };
  // The local blocks the SERVER last accepted: seeded when a board loads and
  // advanced on each confirmed updateRun save. An expired or rejected save
  // snaps the board back to this maze (see the run-saver handlers in useInit).
  const savedBlocksRef = useRef<ReadonlyArray<BoardBlock>>([]);
  // Transient implosion ghosts where a reverted (never-persisted) block
  // vanished. Each self-clears ~0.4s after spawn.
  const [implosions, setImplosions] = useState<
    ReadonlyArray<Point & { id: number; thunder?: boolean | undefined }>
  >([]);
  // The iteration's full brick/power budget, set when the board loads (a
  // resumed run adds back what it placed). -1 until a board has loaded, which
  // also hides the two chips. These totals are STATE; the remaining counts are
  // derived, below.
  const [bricksTotal, _setBricksTotal] = useState(-1);
  const [powerTotal, _setPowerTotal] = useState(-1);
  // Mirrors of the totals readable before a re-render, like `timeRef`;
  // `budgetNow` reads them.
  const bricksTotalRef = useRef(-1);
  const powerTotalRef = useRef(-1);
  const setBricksTotal: typeof _setBricksTotal = (n) => {
    bricksTotalRef.current = typeof n === "function"
      ? n(bricksTotalRef.current)
      : n;
    _setBricksTotal(n);
  };
  const setPowerTotal: typeof _setPowerTotal = (n) => {
    powerTotalRef.current = typeof n === "function"
      ? n(powerTotalRef.current)
      : n;
    _setPowerTotal(n);
  };
  /**
   * The remaining brick/power counts: the board's totals minus the maze on it.
   * NOT state.
   *
   * Do not step it per gesture (-1 on a placement, +1 on a delete): a stale
   * board write can put a deleted block back after its refund landed, so the
   * HUD offers a brick the budget never had. Spending it builds a maze one
   * piece over, which `validateRun` rejects at commit ("too many blocks"),
   * losing the free-play run. Derived from the board, the chips always
   * describe THAT maze.
   *
   * The totals carry the -1 "no board loaded" sentinel, so `clear`/prestart
   * blank the chips by clearing the budget rather than the count.
   */
  const { bricks, power } = useMemo(
    () =>
      mazeBudget(blocks.filter((b) => b.local), {
        bricks: bricksTotal,
        power: powerTotal,
      }),
    [blocks, bricksTotal, powerTotal],
  );
  /**
   * The same figure at POINTER time, for the input hooks: a gesture within a
   * frame of the previous one is judged against the board as it stands, not as
   * the render that registered the listener saw it.
   */
  const budgetNow = () =>
    mazeBudget(blocksRef.current.filter((b) => b.local), {
      bricks: bricksTotalRef.current,
      power: powerTotalRef.current,
    });
  const [time, _setTime] = useState(-2);
  // The input hooks read the clock through this mirror; `time` in their
  // dependency arrays would re-register the global listeners every tick.
  const timeRef = useRef(time);
  const setTime: typeof _setTime = (t) => {
    timeRef.current = typeof t === "function" ? t(timeRef.current) : t;
    _setTime(t);
  };
  // Wall-clock end of the build window (ms epoch). The countdown derives from
  // it (see useClock) rather than decrementing, so a throttled background-tab
  // interval can't leave the client "building" past the window. Null while no
  // countdown ticks (staged free play before the opening placement).
  const deadlineRef = useRef<number | null>(null);
  // The iteration currently loaded on the board (ranked or free-play).
  const [iteration, setIteration] = useState<number>();
  // Free play stages the board without a run: `staged` freezes the build clock
  // (a placement opens the run); `freePlay` marks the attempt unranked, so it
  // re-stages instead of starting a ranked run when it finishes.
  const [staged, setStaged] = useState(false);
  const [freePlay, setFreePlay] = useState(false);
  // A daily attempt is ready but unstarted: the "Start attempt" overlay is up
  // over an inert, empty board (the day's pieces are NOT staged). Drives the
  // "prestart" phase.
  const [prestart, setPrestart] = useState(false);
  // Field / personal bests and the iteration floor, set when a board loads.
  // Free play colours the live timer by the score in [min, best] and reads a
  // finished run's milestone off these (see verdict.ts). NaN until loaded;
  // ownBest is null with no prior run.
  const [min, setMin] = useState(NaN);
  const [best, setBest] = useState(NaN);
  const [ownBest, setOwnBest] = useState<number | null>(null);
  // The just-finished free-play run's milestone (personal best / record /
  // supreme), held until the board re-stages.
  const [verdict, setVerdict] = useState<Verdict>();
  // True while reviewing a past maze (static, non-playable); the HUD shows a
  // Play button.
  const [viewing, setViewing] = useState(false);
  const grid = useRef(newGrid()).current;
  const [run, setRun] = useState<
    {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    }
  >();
  const [date, setDate] = useState(NaN);
  // Mobile-only: the full-screen calendar picker's open state (desktop shows
  // the calendar inline).
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [attempts, setAttempts] = useState<
    MessageMap["getDailySummary"]["attempts"]
  >();
  const [attemptsRemaining, setAttemptsRemaining] = useState(-1);
  // The completed attempts on the board being viewed (the attempts panel),
  // separate from the `attempts` that trigger the result modal.
  const [viewedAttempts, setViewedAttempts] = useState<
    MessageMap["getDailySummary"]["attempts"]
  >([]);

  const clear = () => {
    setRun(undefined);
    setCheckpoint({ x: -2, y: -2 });
    setBlocks([]);
    // Clearing the budget is what hides the chips (they derive from it).
    setBricksTotal(-1);
    setPowerTotal(-1);
    setTime(-1);
    setDate(NaN);
    clearTouchZoom();
    invalid.value = false;
    transitionBlock.value = undefined;
    placingBlock.value = { ...placingBlock.value, placing: false };
    thunderHover.value = undefined;
    setStaged(false);
    setFreePlay(false);
    setPrestart(false);
    setViewing(false);
    setVerdict(undefined);
    dragMoved.value = false;
  };

  // Raise the daily "Start attempt" overlay: a clean, inert board. The day's
  // pieces are NOT laid out (the Start button fires `startRun`), so nothing
  // here can leak the puzzle or open a run. `time` leaves loading (-2) so the
  // phase resolves to "prestart", and sits at -1 so the input hooks stay inert.
  const enterPrestart = () => {
    setRun(undefined);
    setStaged(false);
    setFreePlay(false);
    setViewing(false);
    setVerdict(undefined);
    // The overlay is always today's daily, so reset to today (undefined);
    // otherwise a prestart from another day leaks that day's standings behind
    // the overlay and deep-links a refresh back onto it.
    setIteration(undefined);
    setPrestart(true);
    setBlocks([]);
    setBricksTotal(-1);
    setPowerTotal(-1);
    setTime(-1);
    deadlineRef.current = null;
    clearTouchZoom();
    invalid.value = false;
    transitionBlock.value = undefined;
    placingBlock.value = { ...placingBlock.value, placing: false };
    thunderHover.value = undefined;
    dragMoved.value = false;
  };

  // Review a previously-built maze (a past attempt or your best): a
  // non-playable view keeping the iteration's fixed pieces and checkpoint, with
  // the reviewed maze as the local blocks. `replay` RELEASES the runner over it
  // (asking to see a maze means seeing it run). The one caller that opts out is
  // the review a just-finished free-play run lands in (see useInit).
  const viewMaze = (
    maze: ReadonlyArray<Point & { thunder?: boolean }>,
    { replay = true }: { replay?: boolean } = {},
  ) => {
    setRun(undefined);
    // A lingering free-play verdict would override the HUD.
    setVerdict(undefined);
    // A live free-play build's window does NOT pause during a review, so its
    // countdown stays on the clock and Play resumes with what is left. Every
    // other state parks the clock at -1. The ticking clock can't make the board
    // editable: the input hooks gate on `viewing`.
    //
    // "A build is live" is the DEADLINE, not `staged`: a caller that staged a
    // board and overlays a maze in a `.then` has the previous render's `staged`
    // in its closure while `timeRef` already reads the fresh board's 60, so the
    // review kept a ticking clock it never had. The deadline ref is written
    // synchronously: null on a staged board, set only once a window is open.
    if (!(freePlay && deadlineRef.current !== null && timeRef.current > 0)) {
      setTime(-1);
    }
    setStaged(false);
    // Exits prestart so the review is visible.
    setPrestart(false);
    // The chips need no writing here: they derive from the board, so laying the
    // maze down below sets them (also right for a cross-day caller whose
    // closure holds another day's budget).
    clearTouchZoom();
    invalid.value = false;
    transitionBlock.value = undefined;
    thunderHover.value = undefined;
    placingBlock.value = { ...placingBlock.value, placing: false };
    setViewing(true);
    const next = [
      ...blocksRef.current.filter((b) => !b.local),
      ...maze.map((b) => ({ ...b, local: true })),
    ];
    setBlocks(next);
    // Same engine as the build preview and the server, so the replayed path is
    // the one behind the stored time. An unsolvable maze (bad data) leaves the
    // board static.
    if (replay) setRun(localRun(next, checkpointRef.current));
  };

  const phase: BoardPhase = time === -2
    ? "loading"
    : prestart
    ? "prestart"
    : viewing
    ? "viewing"
    : staged
    ? "staged"
    : run && time < 0
    ? "running"
    : time > 0
    ? "building"
    : "idle";

  // The player is mid-run on TODAY's ranked daily (loading / prestart /
  // building / running), not free-playing or reviewing a past day. This, not
  // `attemptsRemaining` alone, gates the "no wandering off / no spoiling the
  // field" surfaces (calendar, profile and notifications buttons, runs-panel
  // detail, standings reveal): `attemptsRemaining` belongs to today's daily,
  // but the board can show a PAST day (a /YYYYMMDD link, or a day left open
  // across midnight), where those must stay available. Free play with ranked
  // attempts remaining can only be a past day, so `!freePlay &&
  // attemptsRemaining !== 0` is exactly "on today's live ranked daily".
  const dailyInProgress = !freePlay && attemptsRemaining !== 0;

  return {
    dailyInProgress,
    blocks,
    // The live maze for the input hooks (see budgetNow).
    blocksRef,
    savedBlocksRef,
    implosions,
    setImplosions,
    bricks,
    // The same two counts at pointer time, for the input hooks.
    budgetNow,
    bricksTotal,
    powerTotal,
    checkpoint,
    date,
    grid,
    phase,
    power,
    run,
    setBlocks,
    setBricksTotal,
    setPowerTotal,
    setCheckpoint,
    setDate,
    setRun,
    setTime,
    timeRef,
    deadlineRef,
    time,
    dragRef,
    placingRef,
    attempts,
    setAttempts,
    clear,
    viewMaze,
    enterPrestart,
    attemptsRemaining,
    setAttemptsRemaining,
    viewedAttempts,
    setViewedAttempts,
    iteration,
    setIteration,
    staged,
    setStaged,
    freePlay,
    setFreePlay,
    prestart,
    setPrestart,
    viewing,
    setViewing,
    calendarOpen,
    setCalendarOpen,
    min,
    setMin,
    best,
    setBest,
    ownBest,
    setOwnBest,
    verdict,
    setVerdict,
  };
};
