import { createContext } from "preact";
import { useRef, useState } from "preact/compat";
import { newGrid } from "../../../common/pathing.ts";
import { Point } from "../../../common/types.ts";
import { MessageMap } from "../../api.ts";

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
  const placingBlockRef = useRef({ x: 0, y: 0, placing: false });
  const [, _setPlacingBlock] = useState(placingBlockRef.current);
  const setPlacingBlock: typeof _setPlacingBlock = (s) => {
    if (typeof s === "function") {
      placingBlockRef.current = s(placingBlockRef.current);
    } else placingBlockRef.current = s;
    _setPlacingBlock(s);
  };
  const [transitionBlock, setTransitionBlock] = useState<
    Point & { local?: boolean; thunder?: boolean; active?: boolean }
  >();
  // The local block currently grabbed for a drag (repositioning), if any.
  // `startX/startY` is the cell the pointer pressed in; `dragged` sticks true
  // once the pointer leaves it, so a tap doesn't nudge the block and a
  // return-to-origin release snaps back rather than deleting.
  const dragRef = useRef<
    | {
      origin: Point & { local?: boolean; thunder?: boolean; active?: boolean };
      dragged: boolean;
      startX: number;
      startY: number;
    }
    | null
  >(null);
  const [checkpoint, setCheckpoint] = useState<Point>({ x: -2, y: -2 });
  const [blocks, setBlocks] = useState<
    ReadonlyArray<NonNullable<typeof transitionBlock>>
  >(
    [],
  );
  const [bricks, setBricks] = useState(-1);
  const [power, setPower] = useState(-1);
  const [time, setTime] = useState(-2);
  // The iteration currently loaded on the board (ranked or free-play).
  const [iteration, setIteration] = useState<number>();
  // Free play stages the board without a run: `staged` freezes the build clock
  // (a placement, not the timer, opens the run); `freePlay` marks the whole
  // attempt as unranked so it re-stages rather than starting a ranked run when
  // it finishes.
  const [staged, setStaged] = useState(false);
  const [freePlay, setFreePlay] = useState(false);
  // True while reviewing a past maze (a static, non-playable view). The HUD
  // surfaces a Play button in this state so there's an obvious way back to a
  // live board.
  const [viewing, setViewing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const grid = useRef(newGrid()).current;
  const [run, setRun] = useState<
    {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    }
  >();
  const [touching, setTouching] = useState(false);
  const [thunderHover, setThunderHover] = useState<
    Point & { local?: boolean }
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
    setTouching(false);
    setInvalid(false);
    setTransitionBlock(undefined);
    setPlacingBlock((pb) => ({ ...pb, placing: false }));
    setThunderHover(undefined);
    setStaged(false);
    setFreePlay(false);
    setViewing(false);
  };

  // Review a previously-built maze (a past attempt or your best) on the board:
  // drop into a static, non-playable view keeping the iteration's fixed pieces
  // and checkpoint, with the reviewed maze as the local blocks.
  const viewMaze = (maze: ReadonlyArray<Point & { thunder?: boolean }>) => {
    setRun(undefined);
    setStaged(false);
    setTime(-1);
    setBricks(-1);
    setPower(-1);
    setTouching(false);
    setInvalid(false);
    setTransitionBlock(undefined);
    setThunderHover(undefined);
    setPlacingBlock((pb) => ({ ...pb, placing: false }));
    setViewing(true);
    setBlocks((blocks) => [
      ...blocks.filter((b) => !b.local),
      ...maze.map((b) => ({ ...b, local: true })),
    ]);
  };

  return {
    blocks,
    bricks,
    checkpoint,
    date,
    grid,
    invalid,
    placingBlockRef,
    power,
    run,
    setBlocks,
    setBricks,
    setCheckpoint,
    setDate,
    setInvalid,
    setPlacingBlock,
    setPower,
    setRun,
    setThunderHover,
    setTime,
    setTouching,
    setTransitionBlock,
    thunderHover,
    time,
    touching,
    transitionBlock,
    dragRef,
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
  };
};
