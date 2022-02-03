import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { h } from "preact";
import { Action } from "./Action.tsx";
import { Card } from "./Card.tsx";
import { ConnectionContext } from "../contexts/Connection.ts";
import { StartMessage } from "../../common/serverToClientMessage.ts";
import { Point } from "../../common/types.ts";

export const Game = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const connection = useContext(ConnectionContext);

  const [placingBlock, setPlacingBlock] = useState({
    x: 0,
    y: 0,
    placing: false,
  });

  const handleStartThunder = () => {
    console.log("hi!");
  };

  const handleReady = () => {
    console.log("ready");
  };

  const [disconnected, setDisconnected] = useState(false);

  const [checkpoint, setCheckpoint] = useState<Point>({ x: -2, y: -2 });
  const [blocks, setBlocks] = useState<ReadonlyArray<Point>>([]);
  const [thunders, setThunders] = useState<ReadonlyArray<Point>>([]);
  const [bricks, setBricks] = useState(0);
  const [power, setPower] = useState(0);
  const [time, setTime] = useState(-1);

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

    return () => {
      connection.removeEventListener("start", startCallback);
      connection.removeEventListener("disconnect", disconnectCallback);
      connection.removeEventListener("connect", connectCallback);
    };
  }, []);

  useEffect(() => {
    const callback = (e: MouseEvent) => {
      if (!svgRef.current) return;
      const box = svgRef.current.getBoundingClientRect();
      setPlacingBlock((pb) => ({
        ...pb,
        x: Math.min(
          Math.max(
            Math.round((e.clientX - box.x) / box.width * 20) - 1,
            1,
          ),
          17,
        ),
        y: Math.min(
          Math.max(
            Math.round((e.clientY - box.y) / box.height * 20) - 1,
            1,
          ),
          17,
        ),
      }));
    };

    globalThis.addEventListener("mousemove", callback);

    return () => globalThis.removeEventListener("mousemove", callback);
  }, [svgRef.current]);

  useEffect(() => {
    const callback = (e: MouseEvent) => {
      setPlacingBlock((pb) => {
        if (!pb.placing) return pb;

        connection.send({ kind: "block", x: pb.x, y: pb.y });
        setBlocks((blocks) => [...blocks, { x: pb.x, y: pb.y }]);
        setBricks((bricks) => bricks - 1);

        return ({ ...pb, placing: false });
      });
    };

    globalThis.addEventListener("mousedown", callback);

    return () => globalThis.removeEventListener("mousedown", callback);
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex" }}>
      <div style={{ flexGrow: 1 }}>
        <div>
          <Action
            hotkey="B"
            name="Block"
            icon="🧱"
            handler={() => setPlacingBlock((pb) => ({ ...pb, placing: true }))}
          />
          <Action
            hotkey="n"
            name="Thunder"
            icon="🧱⚡"
            handler={handleStartThunder}
          />
        </div>
        <div style={{ position: "relative" }}>
          <svg style={{ width: "100%" }} viewBox="-1 -1 21 21" ref={svgRef}>
            <rect x={0} y={0} width={20} height={20} fill="#bee3fb" />
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
            {blocks.map(({ x, y }) => (
              <rect
                x={x}
                y={y}
                width={2}
                height={2}
                fill="#edb9d8"
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
                fill="#edb9d8"
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
                fill="#6bc0f7"
              />
            )}
            {placingBlock.placing && (
              <rect
                x={placingBlock.x}
                y={placingBlock.y}
                width={2}
                height={2}
                fill="#edb9d8"
                stroke="black"
                stroke-width={0.1}
                opacity={0.4}
                style={{ transition: "x 100ms, y 100ms" }}
              />
            )}
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
      </div>
      <div style={{ width: 250 }}>
        <Card>
          Live leaderboard
        </Card>
        <Card>
          Log
        </Card>
      </div>
    </div>
  );
};
