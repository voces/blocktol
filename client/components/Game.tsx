import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { h } from "preact";
import { Card } from "./Card.tsx";
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
  const [bricks, setBricks] = useState(0);
  const [power, setPower] = useState(0);
  const [time, setTime] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const grid = useRef(newGrid()).current;
  const [run, setRun] = useState<Omit<RunMessage, "kind">>();

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
      setTime(60);

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
    const callback = (e: MouseEvent) => {
      if (!svgRef.current || bricks === 0 || time <= 0) return;

      const box = svgRef.current.getBoundingClientRect();
      const x = Math.min(
        Math.max(
          Math.round((e.clientX - box.x) / box.width * 20) - 1,
          1,
        ),
        17,
      );
      const y = Math.min(
        Math.max(
          Math.round((e.clientY - box.y) / box.height * 20) - 1,
          1,
        ),
        17,
      );

      const overlap = blocks.find((b) =>
        Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1
      ) ??
        thunders.find((t) => Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1);

      setPlacingBlock(() => ({ placing: !overlap?.local, x, y }));

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

    globalThis.addEventListener("mousemove", callback);

    return () => globalThis.removeEventListener("mousemove", callback);
  }, [svgRef.current, bricks, blocks, checkpoint, time]);

  useEffect(() => {
    const callback = (e: MouseEvent) => {
      setPlacingBlock((pb) => {
        if (invalid) return pb;

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
            setBricks((bricks) => bricks - 1);
            offsets.forEach(([xd, yd]) =>
              grid[transitionBlock.y + yd][transitionBlock.x + xd] = true
            );
          }

          setTransitionBlock(undefined);
          return pb;
        }

        if (!pb.placing) return pb;

        offsets.forEach(([xd, yd]) => grid[pb.y + yd][pb.x + xd] = true);

        connection.send({ kind: "block", x: pb.x, y: pb.y });
        setBlocks((blocks) => [...blocks, { x: pb.x, y: pb.y, local: true }]);
        setBricks((bricks) => bricks - 1);

        return ({ ...pb, placing: false });
      });
    };

    globalThis.addEventListener("mousedown", callback);

    return () => globalThis.removeEventListener("mousedown", callback);
  }, [transitionBlock, invalid]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <svg
          style={{ width: "100%", display: "block" }}
          viewBox="0 0 20 20"
          ref={svgRef}
        >
          <rect x={0} y={0} width={20} height={20} fill="hsl(220, 60%, 80%)" />
          <rect x={0} y={0} width={9} height={1} fill="#404040" />
          <rect x={11} y={0} width={9} height={1} fill="#404040" />
          <rect x={0} y={19} width={9} height={1} fill="#404040" />
          <rect x={11} y={19} width={9} height={1} fill="#404040" />
          <rect x={0} y={0} width={1} height={20} fill="#404040" />
          <rect x={19} y={0} width={1} height={20} fill="#404040" />
          {bricks >= 0 && (
            <text x={1} y={0.8} font-size={0.8} fill="white">🧱{bricks}</text>
          )}
          {power >= 0 && (
            <text x={3.4} y={0.8} font-size={0.8} fill="white">⚡{power}</text>
          )}
          {time > 0 && (
            <text
              x={18.8}
              y={0.8}
              font-size={0.8}
              fill="white"
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
              // TODO: transition should fork on if we have power
              fill={transitionBlock === block
                ? "hsl(120, 60%, 65%)"
                : block.local
                ? "hsl(120, 60%, 80%)"
                : "hsl(320, 60%, 80%)"}
              stroke="black"
              stroke-width={0.1}
            />
          ))}
          {thunders.map((thunder) => (
            <rect
              x={thunder.x}
              y={thunder.y}
              width={2}
              height={2}
              fill={thunder.local ? "hsl(120, 60%, 50%)" : "hsl(320, 60%, 50%)"}
              opacity={transitionBlock === thunder ? 0.4 : 1}
              stroke="black"
              stroke-width={0.1}
            />
          ))}
          {checkpoint && (
            <rect
              x={checkpoint.x + 0.55}
              y={checkpoint.y + 0.55}
              width={0.9}
              height={0.9}
              fill="hsl(220, 60%, 50%)"
            />
          )}
          {placingBlock.placing && (
            <rect
              x={placingBlock.x}
              y={placingBlock.y}
              width={2}
              height={2}
              fill={invalid ? "hsl(0, 100%, 60%)" : "hsl(120, 60%, 80%)"}
              stroke="black"
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
      <div style={{ width: 250 }}>
        <Card>Live leaderboard</Card>
        <Card>Log</Card>
      </div>
    </div>
  );
};
