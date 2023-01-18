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
  const [checkpoint, setCheckpoint] = useState<Point>({ x: -2, y: -2 });
  const [blocks, setBlocks] = useState<
    ReadonlyArray<NonNullable<typeof transitionBlock>>
  >(
    [],
  );
  const [bricks, setBricks] = useState(-1);
  const [power, setPower] = useState(-1);
  const [time, setTime] = useState(-2);
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
  const [attempts, setAttempts] = useState<
    MessageMap["getDailySummary"]["attempts"]
  >();
  const [attemptsRemaining, setAttemptsRemaining] = useState(-1);

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
    attempts,
    setAttempts,
    clear,
    attemptsRemaining,
    setAttemptsRemaining,
  };
};
