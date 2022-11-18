import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/hooks";
import { h } from "preact";
import { ConnectionContext } from "../contexts/Connection.ts";
import {
  RunMessage,
  StartMessage,
} from "../../common/serverToClientMessage.ts";
import { Point } from "../../common/types.ts";
import { findPath, newGrid } from "../../common/pathing.ts";
import { offsets } from "../../common/constants.ts";
import { Board } from "./Board.tsx";

export const Game = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const connection = useContext(ConnectionContext);
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

  useEffect(() => {
    const interval = setInterval(
      () => setTime((time) => time > 0 ? time - 1 : time),
      1_000,
    );

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const startCallback = (
      { checkpoint, blocks, thunders, ...event }: StartMessage,
    ) => {
      setCheckpoint(checkpoint);
      setThunders(thunders);
      setBlocks(blocks);
      setBricks(event.bricks);
      setPower(event.power);
      setTime(Math.floor(event.time));
      setRating(event.rating);

      grid.splice(0, Infinity, ...newGrid());

      grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
      for (const { x, y } of thunders) {
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
      }
      for (const { x, y } of blocks) {
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
      }
    };
    connection.addEventListener("start", startCallback);

    const disconnectCallback = () => {
      setDisconnected(true);
      setTime(-1);
    };
    connection.addEventListener("disconnect", disconnectCallback);

    const connectCallback = () => {
      setDisconnected(false);
      setCheckpoint({ x: -2, y: -2 });
      setBlocks([]);
      setThunders([]);
      setBricks(0);
      setPower(0);
      setRun(undefined);
      setInvalid(false);
      setTransitionBlock(undefined);
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
    };
    connection.addEventListener("connect", connectCallback);

    const runCallback = ({ path, duration, slows, rating }: RunMessage) => {
      setRun({ path, duration, slows });
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      setTransitionBlock(undefined);
      setTime(-1);
      setBricks(-1);
      setPower(-1);
      setTouching(false);
      setThunderHover(undefined);
      setLastRating(rating);
      setRating(rating);
    };
    connection.addEventListener("run", runCallback);

    return () => {
      connection.removeEventListener("start", startCallback);
      connection.removeEventListener("disconnect", disconnectCallback);
      connection.removeEventListener("connect", connectCallback);
      connection.removeEventListener("run", runCallback);
    };
  }, []);

  useEffect(() => {
    const callback = (clientX: number, clientY: number) => {
      if (!svgRef.current || time <= 0) return;

      const box = svgRef.current.getBoundingClientRect();
      const x = Math.min(
        Math.max(
          Math.round((clientX - box.x) / box.width * 20) - 1,
          1,
        ),
        17,
      );
      const y = Math.min(
        Math.max(
          Math.round((clientY - box.y) / box.height * 20) - 1,
          1,
        ),
        17,
      );

      const overlap = blocks.find((b) =>
        Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1
      ) ??
        thunders.find((t) => Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1);

      setPlacingBlock(() => ({ placing: !overlap?.local && bricks > 0, x, y }));

      let invalid = (!!overlap && !overlap.local) ||
        (Math.abs(checkpoint.x - x) + Math.abs(checkpoint.y - y)) <= 1;
      if (!invalid && !overlap) {
        offsets.forEach(([xd, yd]) =>
          grid[y + yd][x + xd] = true
        );
        try {
          if (!findPath(grid, checkpoint)) invalid = true;
        } catch (err) {
          console.error(err);
        }
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
      }

      setInvalid(invalid);

      if (
        overlap && !overlap.local && thunders.includes(overlap)
      ) {
        setThunderHover(overlap);
      } else {
        setThunderHover(undefined);
      }

      setTransitionBlock(
        overlap?.local ? overlap : undefined,
      );
    };

    const mousemoveCallback = (e: MouseEvent) => callback(e.clientX, e.clientY);
    globalThis.addEventListener("mousemove", mousemoveCallback);

    const touchmoveCallback = (e: TouchEvent) => {
      callback(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    };
    globalThis.addEventListener("touchmove", touchmoveCallback, {
      passive: false,
    });

    const touchstartCallback = (e: TouchEvent) => {
      setTouching(true);
      callback(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    };
    globalThis.addEventListener("touchstart", touchstartCallback);

    return () => {
      globalThis.removeEventListener("mousemove", mousemoveCallback);
      globalThis.removeEventListener("touchstart", touchstartCallback);
      globalThis.removeEventListener("touchmove", touchmoveCallback);
    };
  }, [svgRef.current, bricks, blocks, checkpoint, time]);

  useEffect(() => {
    const callback = () => {
      if (invalid || time <= 0) return;
      if (svgRef.current) svgRef.current.style.transform = "";

      if (transitionBlock) {
        connection.send({
          kind: "transition",
          x: transitionBlock.x,
          y: transitionBlock.y,
        });

        // Remove from blocks
        setBlocks((blocks) =>
          blocks.filter((block) => block !== transitionBlock)
        );

        // Remove from thunders
        let isThunder = false;
        setThunders((thunders) =>
          thunders.filter((thunder) => {
            if (thunder === transitionBlock) {
              isThunder = true;
              return false;
            }
            return true;
          })
        );

        // Upgrade to thunder
        if (power && !isThunder) {
          setThunders((thunders) => [...thunders, transitionBlock]);
          setPower((power) => power - 1);

          // Remove
        } else {
          setBricks((bricks) => bricks + 1);
          if (isThunder) setPower((power) => power + 1);
          offsets.forEach(([xd, yd]) =>
            grid[transitionBlock.y + yd][transitionBlock.x + xd] = false
          );
        }

        setTransitionBlock(undefined);
        // TODO: recall mousemove callback
        return;
      }

      if (!placingBlockRef.current.placing) return;

      offsets.forEach(([xd, yd]) =>
        grid[placingBlockRef.current.y + yd][placingBlockRef.current.x + xd] =
          true
      );

      connection.send({
        kind: "block",
        x: placingBlockRef.current.x,
        y: placingBlockRef.current.y,
      });
      setBlocks((
        blocks,
      ) => [...blocks, {
        x: placingBlockRef.current.x,
        y: placingBlockRef.current.y,
        local: true,
      }]);
      setBricks((bricks) => bricks - 1);

      setPlacingBlock({ ...placingBlockRef.current, placing: false });
    };

    globalThis.addEventListener("mousedown", callback);

    const touchendCallback = (e: TouchEvent) => {
      setTouching(false);
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      callback();
    };
    globalThis.addEventListener("touchend", touchendCallback);

    return () => {
      globalThis.removeEventListener("mousedown", callback);
      globalThis.removeEventListener("touchend", touchendCallback);
    };
  }, [placingBlockRef.current, transitionBlock, invalid]);

  const onSlow = useCallback((thunder: Point) => {
    // Animate thunder tower
    setThunders(
      (thunders) =>
        thunders.map((t) =>
          t.x === thunder.x && t.y === thunder.y
            ? { ...thunder, active: true }
            : t
        ),
    );

    // Remove thunder tower animation after 0.1s
    setTimeout(() => {
      setThunders(
        (thunders) =>
          thunders.map((t) =>
            t.x === thunder.x && t.y === thunder.y
              ? { ...thunder, active: false }
              : t
          ),
      );
    }, 100);
  }, []);

  return (
    <Board
      placingBlock={placingBlockRef.current}
      touching={touching}
      time={time}
      svgRef={svgRef}
      transitionBlock={transitionBlock}
      power={power}
      thunders={thunders}
      thunderHover={thunderHover}
      bricks={bricks}
      blocks={blocks}
      checkpoint={checkpoint}
      invalid={invalid}
      run={run}
      onFinish={() => setRun(undefined)}
      grid={grid}
      disconnected={disconnected}
      onSlow={onSlow}
      rating={rating}
      lastRating={lastRating}
    />
  );
};
