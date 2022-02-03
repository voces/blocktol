import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { h } from "preact";
import { Card } from "./Card.tsx";
import { ConnectionContext } from "../contexts/Connection.ts";
import {
  RunMessage,
  StartMessage,
} from "../../common/serverToClientMessage.ts";
import { Point } from "../../common/types.ts";
import { newGrid } from "../../common/pathing.ts";
import { Runner } from "./Runner.tsx";

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
    const startCallback = (event: StartMessage) => {
      setCheckpoint(event.checkpoint);
      setBlocks(event.blocks);
      setThunders(event.thunders);
      setBricks(event.bricks);
      setPower(event.power);
      setTime(60);
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
    };
    connection.addEventListener("connect", connectCallback);

    const runCallback = ({ path, duration }: RunMessage) => {
      setRun({ path, duration });
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
      if (!svgRef.current || bricks === 0) return;

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

      setPlacingBlock(() => ({ placing: !overlap, x, y }));
      setTransitionBlock(
        overlap?.local
          ? overlap
          : undefined,
      );
    };

    globalThis.addEventListener("mousemove", callback);

    return () => globalThis.removeEventListener("mousemove", callback);
  }, [svgRef.current, bricks, blocks]);

  useEffect(() => {
    const callback = (e: MouseEvent) => {
      setPlacingBlock((pb) => {
        if (transitionBlock) {
          connection.send({
            kind: "transition",
            x: transitionBlock.x,
            y: transitionBlock.y,
          });

          setBlocks((blocks) =>
            blocks.filter((block) => block !== transitionBlock)
          );

          if (power) {
            setThunders((thunders) => [...thunders, transitionBlock]);
            setPower((power) => power - 1);
          } else setBricks((bricks) => bricks - 1);

          setTransitionBlock(undefined);
          return pb;
        }

        if (!pb.placing) return pb;

        connection.send({ kind: "block", x: pb.x, y: pb.y });
        setBlocks((blocks) => [...blocks, { x: pb.x, y: pb.y, local: true }]);
        setBricks((bricks) => bricks - 1);

        return ({ ...pb, placing: false });
      });
    };

    globalThis.addEventListener("mousedown", callback);

    return () => globalThis.removeEventListener("mousedown", callback);
  }, [transitionBlock]);

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
          <text x={1} y={0.8} font-size={0.8} fill="white">🧱{bricks}</text>
          <text x={3.4} y={0.8} font-size={0.8} fill="white">⚡{power}</text>
          <text
            x={18.8}
            y={0.8}
            font-size={0.8}
            fill="white"
            text-anchor="end"
          >
            {time} seconds to build
          </text>
          {blocks.map((block) => (
            <rect
              x={block.x}
              y={block.y}
              width={2}
              height={2}
              fill={transitionBlock === block
                ? "hsl(120, 60%, 65%)"
                : block.local
                ? "hsl(120, 60%, 80%)"
                : "hsl(320, 60%, 80%)"}
              stroke="black"
              stroke-width={0.1}
            />
          ))}
          {thunders.map(({ x, y }) => (
            <rect
              x={x}
              y={y}
              width={2}
              height={2}
              fill="hsl(320, 60%, 50%)"
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
              fill="hsl(120, 60%, 80%)"
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
