import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { h } from "preact";
import { ConnectionContext } from "../contexts/Connection.ts";
import {
  RunMessage,
  StartMessage,
} from "../../common/serverToClientMessage.ts";
import { Point } from "../../common/types.ts";
import { findPath, newGrid } from "../../common/pathing.ts";
import { Runner } from "./Runner.tsx";
import { offsets } from "../../common/constants.ts";

export const Game = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const connection = useContext(ConnectionContext);
  const [placingBlock, setPlacingBlock] = useState({
    x: 0,
    y: 0,
    placing: false,
  });
  const [transitionBlock, setTransitionBlock] = useState<Point>();
  const [disconnected, setDisconnected] = useState(false);
  const [checkpoint, setCheckpoint] = useState<Point>({ x: -2, y: -2 });
  const [blocks, setBlocks] = useState<
    ReadonlyArray<Point & { local?: boolean }>
  >([]);
  const [thunders, setThunders] = useState<
    ReadonlyArray<Point & { local?: boolean }>
  >([]);
  const [bricks, setBricks] = useState(-1);
  const [power, setPower] = useState(-1);
  const [time, setTime] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const grid = useRef(newGrid()).current;
  const [run, setRun] = useState<{ path: Point[]; duration: number }>();
  const [touching, setTouching] = useState(false);

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

    const runCallback = ({ path, duration }: RunMessage) => {
      setRun({ path, duration });
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      setTransitionBlock(undefined);
      setTime(-1);
      setBricks(-1);
      setPower(-1);
      setTouching(false);
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
        if (!findPath(grid, checkpoint)) invalid = true;
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
      }

      setInvalid(invalid);

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

        setBlocks((blocks) =>
          blocks.filter((block) => block !== transitionBlock)
        );
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

        if (power && !isThunder) {
          setThunders((thunders) => [...thunders, transitionBlock]);
          setPower((power) => power - 1);
        } else {
          setBricks((bricks) => bricks + 1);
          if (isThunder) setPower((power) => power + 1);
          offsets.forEach(([xd, yd]) =>
            grid[transitionBlock.y + yd][transitionBlock.x + xd] = true
          );
        }

        setTransitionBlock(undefined);
        return;
      }

      if (!placingBlock.placing) return;

      offsets.forEach(([xd, yd]) =>
        grid[placingBlock.y + yd][placingBlock.x + xd] = true
      );

      connection.send({ kind: "block", x: placingBlock.x, y: placingBlock.y });
      setBlocks((
        blocks,
      ) => [...blocks, { x: placingBlock.x, y: placingBlock.y, local: true }]);
      setBricks((bricks) => bricks - 1);

      setPlacingBlock({ ...placingBlock, placing: false });
    };

    globalThis.addEventListener("mousedown", callback);

    const touchendCallback = () => {
      setTouching(false);
      callback();
    };
    globalThis.addEventListener("touchend", touchendCallback);

    return () => {
      globalThis.removeEventListener("mousedown", callback);
      globalThis.removeEventListener("touchend", touchendCallback);
    };
  }, [placingBlock, transitionBlock, invalid]);

  return (
    <div
      style={{
        maxWidth: "min(800px, 100vw, calc(100vh - 110px))",
        margin: "0 auto",
      }}
    >
      <svg
        style={{
          width: "100%",
          display: "block",
          transition: "transform 100ms, transform-origin 100ms",
          transformOrigin: `${(placingBlock.x + 1) * 5}% ${
            placingBlock.y * 5
          }%`,
          transform: touching && time > 0 ? "scale(2)" : undefined,
        }}
        viewBox="0 0 20 20"
        ref={svgRef}
      >
        <rect
          x={0}
          y={0}
          width={20}
          height={20}
          fill="var(--maze-background)"
        />
        <rect x={0} y={0} width={9} height={1} fill="var(--maze-wall)" />
        <rect x={11} y={0} width={9} height={1} fill="var(--maze-wall)" />
        <rect x={0} y={19} width={9} height={1} fill="var(--maze-wall)" />
        <rect x={11} y={19} width={9} height={1} fill="var(--maze-wall)" />
        <rect x={0} y={0} width={1} height={20} fill="var(--maze-wall)" />
        <rect x={19} y={0} width={1} height={20} fill="var(--maze-wall)" />
        {bricks >= 0 && (
          <text x={1} y={0.8} font-size={0.8} fill="var(--maze-text)">
            🧱{bricks}
          </text>
        )}
        {power >= 0 && (
          <text x={3.4} y={0.8} font-size={0.8} fill="var(--maze-text)">
            ⚡{power}
          </text>
        )}
        {time > 0 && (
          <text
            x={18.8}
            y={0.8}
            font-size={0.8}
            fill="var(--maze-text)"
            text-anchor="end"
          >
            {time} seconds to build
          </text>
        )}

        {blocks.map((block) => (
          <rect
            x={block.x}
            y={block.y}
            width={2}
            height={2}
            fill={transitionBlock === block && power > 0
              ? "var(--maze-upgrade-to-thunder)"
              : block.local
              ? "var(--maze-player-block)"
              : "var(--maze-game-block)"}
            opacity={transitionBlock === block && power === 0 ? 0.6 : undefined}
            stroke="var(--maze-stroke)"
            stroke-width={0.1}
          />
        ))}
        {thunders.map((thunder) => (
          <rect
            x={thunder.x}
            y={thunder.y}
            width={2}
            height={2}
            fill={thunder.local
              ? "var(--player-thunder)"
              : "var(--game-thunder)"}
            opacity={transitionBlock === thunder ? 0.4 : 1}
            stroke="var(--maze-stroke)"
            stroke-width={0.1}
          />
        ))}
        {checkpoint && (
          <rect
            x={checkpoint.x + 0.55}
            y={checkpoint.y + 0.55}
            width={0.9}
            height={0.9}
            fill="var(--maze-checkpoint)"
          />
        )}
        {placingBlock.placing && (
          <rect
            x={placingBlock.x}
            y={placingBlock.y}
            width={2}
            height={2}
            fill={invalid
              ? "var(--maze-placing-error)"
              : "var(--maze-placing-block)"}
            stroke="var(--maze-stroke)"
            stroke-width={0.1}
            opacity={0.4}
            style={{ transition: "x 100ms, y 100ms" }}
          />
        )}
        {run && <Runner {...run} onFinish={() => setRun(undefined)} />}
      </svg>
      {disconnected && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            color: "white",
            fontSize: "200%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          Disconnected
        </div>
      )}
    </div>
  );
};
