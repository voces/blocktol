import { createContext } from "preact";
import { useRef, useState } from "preact/compat";
import { newGrid } from "../../../common/pathing.ts";
import { Point } from "../../../common/types.ts";
import { MessageMap } from "../../api.ts";
import {
  BoardBlock,
  dragMoved,
  invalid,
  placingBlock,
  thunderHover,
  touching,
  transitionBlock,
} from "./interaction.ts";
import { Verdict } from "./verdict.ts";

// The board's mode — one name for what the sentinels (time / staged / viewing
// / run) encode in combination. Derived, not enforced: writers still set the
// primitives, but consumers get a legal state by construction instead of
// re-deriving the combination themselves.
export type BoardPhase =
  | "loading" // nothing fetched yet (boot)
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
    // deno-lint-ignore no-explicit-any
  }) as any,
);

export const useGameState = () => {
  // The local block currently grabbed for a drag (repositioning), if any.
  // `startX/startY` is the cell the pointer pressed in and `startClientX/Y` the
  // raw press point in screen pixels; `dragged` sticks true only once the pointer
  // both leaves the pressed cell AND travels past a small pixel slop — so a tap
  // (or a jitter, or the shift the placing zoom slides under a held finger)
  // doesn't nudge the block, and a return-to-origin release snaps back rather
  // than deleting.
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
  // True while a fresh-block placement press is in progress (pressed an empty
  // cell with bricks in hand, not grabbing an existing block). Lets the hover
  // logic treat the moving preview over any block as an invalid spot (a red
  // preview) rather than the tap-to-upgrade preview, which is meant for a bare
  // hover over your own block. Cleared on release.
  const placingRef = useRef(false);
  const [checkpoint, setCheckpoint] = useState<Point>({ x: -2, y: -2 });
  const [blocks, setBlocks] = useState<ReadonlyArray<BoardBlock>>([]);
  // The local blocks the SERVER last accepted: seeded when a board loads
  // (startRun / getBoard / summary resume) and advanced on each confirmed
  // updateRun save. Edits stay optimistic; when a save comes back expired or
  // rejected, the board snaps back to this maze — the one the run will
  // actually execute (see the run-saver handlers wired in useInit).
  const savedBlocksRef = useRef<ReadonlyArray<BoardBlock>>([]);
  // Transient implosion ghosts: where a reverted (never-persisted) block just
  // vanished, a short puff-then-collapse plays so the removal reads as
  // deliberate rather than a glitch. Each ghost self-clears ~0.4s after spawn.
  const [implosions, setImplosions] = useState<
    ReadonlyArray<Point & { id: number; thunder?: boolean }>
  >([]);
  const [bricks, setBricks] = useState(-1);
  const [power, setPower] = useState(-1);
  // The iteration's full brick/power budget (remaining + already placed at load),
  // captured when the board loads so reviewing a past maze can show how much was
  // left over. -1 until a board has loaded.
  const [bricksTotal, setBricksTotal] = useState(-1);
  const [powerTotal, setPowerTotal] = useState(-1);
  const [time, _setTime] = useState(-2);
  // Handlers registered once (the input hooks) read the clock through this
  // mirror rather than putting `time` in their dependency arrays — which
  // re-registered the global listeners on every tick.
  const timeRef = useRef(time);
  const setTime: typeof _setTime = (t) => {
    timeRef.current = typeof t === "function" ? t(timeRef.current) : t;
    _setTime(t);
  };
  // Wall-clock end of the build window (ms epoch), set when a run loads. The
  // countdown derives from it (see useClock) instead of decrementing, so a
  // background-tab-throttled interval can't leave the client "building" after
  // the server's window closed. Null while no countdown should tick (staged
  // free play before the opening placement's startRun response).
  const deadlineRef = useRef<number | null>(null);
  // The iteration currently loaded on the board (ranked or free-play).
  const [iteration, setIteration] = useState<number>();
  // Free play stages the board without a run: `staged` freezes the build clock
  // (a placement, not the timer, opens the run); `freePlay` marks the whole
  // attempt as unranked so it re-stages rather than starting a ranked run when
  // it finishes.
  const [staged, setStaged] = useState(false);
  const [freePlay, setFreePlay] = useState(false);
  // Field / personal bests and the iteration floor, captured when a board loads.
  // Free play colours the live timer by the run's score in [min, best] and reads
  // a finished run's milestone off these (see verdict.ts). NaN until a board with
  // this data has loaded; ownBest is null when you've no prior run on it.
  const [min, setMin] = useState(NaN);
  const [best, setBest] = useState(NaN);
  const [ownBest, setOwnBest] = useState<number | null>(null);
  // The just-finished free-play run's milestone (personal best / record /
  // supreme), held for a beat so the timer pill and floating badge can celebrate
  // it before the board re-stages. Undefined the rest of the time.
  const [verdict, setVerdict] = useState<Verdict>();
  // True while reviewing a past maze (a static, non-playable view). The HUD
  // surfaces a Play button in this state so there's an obvious way back to a
  // live board.
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
  // Mobile-only: the full-screen calendar picker's open state. Opened by the
  // header calendar button, closed by picking a day or dismissing. Desktop shows
  // the calendar inline and ignores this.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [attempts, setAttempts] = useState<
    MessageMap["getDailySummary"]["attempts"]
  >();
  const [attemptsRemaining, setAttemptsRemaining] = useState(-1);
  // The completed attempts on the maze currently being viewed (feeds the
  // attempts panel), independent of the `attempts` that trigger the result modal.
  const [viewedAttempts, setViewedAttempts] = useState<
    MessageMap["getDailySummary"]["attempts"]
  >([]);

  const clear = () => {
    setRun(undefined);
    setCheckpoint({ x: -2, y: -2 });
    setBlocks([]);
    setBricks(-1);
    setPower(-1);
    setTime(-1);
    setDate(NaN);
    touching.value = false;
    invalid.value = false;
    transitionBlock.value = undefined;
    placingBlock.value = { ...placingBlock.value, placing: false };
    thunderHover.value = undefined;
    setStaged(false);
    setFreePlay(false);
    setViewing(false);
    setVerdict(undefined);
    dragMoved.value = false;
  };

  // Review a previously-built maze (a past attempt or your best) on the board:
  // drop into a static, non-playable view keeping the iteration's fixed pieces
  // and checkpoint, with the reviewed maze as the local blocks.
  const viewMaze = (maze: ReadonlyArray<Point & { thunder?: boolean }>) => {
    setRun(undefined);
    setStaged(false);
    // Reviewing a past maze leaves the board inert (Play button); drop any
    // lingering free-play verdict so it doesn't keep overriding the HUD.
    setVerdict(undefined);
    setTime(-1);
    // Show what this run left unspent: every placed block cost a brick, every
    // thunder an extra snowflake. 0/0 when the whole budget was used. Hidden (-1)
    // only if we somehow never loaded the board's budget.
    const usedBricks = maze.length;
    const usedPower = maze.filter((b) => b.thunder).length;
    setBricks(bricksTotal < 0 ? -1 : Math.max(0, bricksTotal - usedBricks));
    setPower(powerTotal < 0 ? -1 : Math.max(0, powerTotal - usedPower));
    touching.value = false;
    invalid.value = false;
    transitionBlock.value = undefined;
    thunderHover.value = undefined;
    placingBlock.value = { ...placingBlock.value, placing: false };
    setViewing(true);
    setBlocks((blocks) => [
      ...blocks.filter((b) => !b.local),
      ...maze.map((b) => ({ ...b, local: true })),
    ]);
  };

  const phase: BoardPhase = time === -2
    ? "loading"
    : viewing
    ? "viewing"
    : staged
    ? "staged"
    : run && time < 0
    ? "running"
    : time > 0
    ? "building"
    : "idle";

  return {
    blocks,
    savedBlocksRef,
    implosions,
    setImplosions,
    bricks,
    bricksTotal,
    powerTotal,
    checkpoint,
    date,
    grid,
    phase,
    power,
    run,
    setBlocks,
    setBricks,
    setBricksTotal,
    setPowerTotal,
    setCheckpoint,
    setDate,
    setPower,
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
