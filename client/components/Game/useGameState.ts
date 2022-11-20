import { createContext } from "preact";
import { useRef, useState } from "preact/hooks";
import { newGrid } from "../../../common/pathing.ts";
import { Point } from "../../../common/types.ts";

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
  const [transitionBlock, setTransitionBlock] = useState<Point>();
  const [disconnected, setDisconnected] = useState(false);
  const [checkpoint, setCheckpoint] = useState<Point>({ x: -2, y: -2 });
  const [blocks, setBlocks] = useState<
    ReadonlyArray<Point & { local?: boolean }>
  >([]);
  const [thunders, setThunders] = useState<
    ReadonlyArray<Point & { local?: boolean; active?: boolean }>
  >([]);
  const [bricks, setBricks] = useState(-1);
  const [power, setPower] = useState(-1);
  const [time, setTime] = useState(-1);
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
  const [lastRating, setLastRating] = useState(NaN);
  const [rating, setRating] = useState(NaN);

  return {
    setTime,
    time,
    blocks,
    thunders,
    setPlacingBlock,
    bricks,
    checkpoint,
    grid,
    setInvalid,
    setThunderHover,
    setTransitionBlock,
    invalid,
    setTouching,
    transitionBlock,
    setBlocks,
    setThunders,
    power,
    setPower,
    setBricks,
    placingBlockRef,
    touching,
    thunderHover,
    run,
    setRun,
    disconnected,
    rating,
    lastRating,
    setCheckpoint,
    setRating,
    setDisconnected,
    setLastRating,
  };
};
