import { Fragment, h, Ref } from "preact";

import { Runner } from "./Runner.tsx";
import { Disconnected } from "./Disconnected.tsx";
import { Block } from "./Block.tsx";
import { debug } from "../util/debug.ts";
import { Point } from "../../common/types.ts";

export const Board = (
  {
    placingBlock,
    touching,
    time,
    svgRef,
    transitionBlock,
    power,
    thunders,
    thunderHover,
    bricks,
    blocks,
    checkpoint,
    invalid,
    run,
    onFinish,
    grid,
    disconnected,
    onSlow,
    rating,
    lastRating,
    date,
  }: {
    placingBlock: Point & { placing: boolean };
    touching: boolean;
    time: number;
    svgRef: Ref<SVGSVGElement>;
    transitionBlock: Point | undefined;
    power: number;
    thunders: ReadonlyArray<Point & { local?: boolean; active?: boolean }>;
    thunderHover: (Point & { local?: boolean }) | undefined;
    bricks: number;
    blocks: ReadonlyArray<Point & { local?: boolean }>;
    checkpoint: Point;
    invalid: boolean;
    run: {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    } | undefined;
    onFinish: () => void;
    grid: boolean[][];
    disconnected: boolean;
    onSlow: (thunder: Point & { local?: boolean }) => void;
    rating: number;
    lastRating: number;
    date: number;
  },
) => (
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
        transformOrigin: `${(placingBlock.x + 1) * 5}% ${placingBlock.y * 5}%`,
        transform: touching && time > 0 ? "scale(2)" : undefined,
      }}
      viewBox="0 0 20 20"
      ref={svgRef}
    >
      <defs>
        <linearGradient id="Striped" x1="0%" y1="0%" x2="10%" y2="10%">
          <stop offset="0%" stop-color="rgba(255, 0, 0, 0.2)" />
          <stop offset="50%" stop-color="rgba(0, 0, 0, 0)" />
        </linearGradient>
        <linearGradient
          id="repeat"
          href="#Striped"
          spreadMethod="repeat"
        />
      </defs>
      <rect
        x={0}
        y={0}
        width={20}
        height={20}
        fill="var(--maze-background)"
      />
      {transitionBlock && (power > 0 || thunders.includes(transitionBlock)) &&
        (
          <circle
            cx={transitionBlock.x + 1}
            cy={transitionBlock.y + 1}
            fill="var(--maze-thunder-radius)"
            r={4}
            z-index={1}
          />
        )}
      {thunderHover && !thunderHover.local &&
        (
          <circle
            cx={thunderHover.x + 1}
            cy={thunderHover.y + 1}
            fill="var(--maze-thunder-radius)"
            r={4}
            z-index={1}
          />
        )}
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
      {!Number.isNaN(rating) && (
        <text
          x={18.8}
          y={19.75}
          font-size={0.8}
          fill="var(--maze-text)"
          text-anchor="end"
        >
          {`${Math.round(rating)}${
            !Number.isNaN(lastRating) && lastRating !== rating
              ? ` (${rating > lastRating ? "+" : ""}${
                (rating - lastRating).toFixed(1)
              })`
              : ""
          }`}
        </text>
      )}
      {!Number.isNaN(date) && (
        <text x={1.2} y={19.75} font-size={0.8} fill="var(--maze-text)">
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
            new Date(date),
          )}
        </text>
      )}

      {blocks.map((block) => (
        <Block
          x={block.x}
          y={block.y}
          color={transitionBlock === block && power > 0
            ? "upgrade-to-thunder"
            : block.local
            ? "player-block"
            : "game-block"}
          opacity={transitionBlock === block && power === 0 ? 0.6 : undefined}
        />
      ))}
      {thunders.map((thunder) => (
        <>
          <Block
            x={thunder.x}
            y={thunder.y}
            color={thunder.local ? "player-thunder" : "game-thunder"}
            opacity={transitionBlock === thunder ? 0.4 : 1}
          />
          {thunder.active && (
            <circle
              cx={thunder.x + 1}
              cy={thunder.y + 1}
              fill="var(--maze-thunder-radius)"
              r={4}
              z-index={1}
            />
          )}
        </>
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
        <Block
          x={placingBlock.x}
          y={placingBlock.y}
          color={invalid ? "placing-error" : "placing-block"}
          opacity={0.4}
          style={{ transition: "x 100ms, y 100ms" }}
        />
      )}
      {run && (
        <Runner
          {...run}
          onFinish={onFinish}
          onSlow={(thunder) =>
            onSlow(
              thunders.find((t) => thunder.x === t.x && thunder.y === t.y)!,
            )}
        />
      )}
      {debug && grid.flatMap((row, y) =>
        row.map((value, x) =>
          value && (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill="url(#repeat)"
            />
          )
        )
      )}
    </svg>
    {disconnected && <Disconnected />}
  </div>
);
