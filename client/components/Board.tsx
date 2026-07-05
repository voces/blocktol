import { Fragment, h, Ref } from "preact";
import { useEffect, useRef } from "preact/compat";

import { Runner } from "./Runner.tsx";
import { Block } from "./Block.tsx";
import { debug } from "../util/debug.ts";
import { Point } from "../../common/types.ts";
import { Timer } from "./Timer.tsx";
import { BottomRight } from "./Board/BottomRight.tsx";
import { TopRight } from "./Board/TopRight.tsx";

export const Board = (
  {
    placingBlock,
    touching,
    time,
    svgRef,
    transitionBlock,
    power,
    thunderHover,
    bricks,
    blocks,
    checkpoint,
    invalid,
    run,
    onFinish,
    grid,
    onSlow,
    date,
  }: {
    placingBlock: Point & { placing: boolean };
    touching: boolean;
    time: number;
    svgRef: Ref<SVGSVGElement>;
    transitionBlock:
      | Point & { local?: boolean; thunder?: boolean; active?: boolean }
      | undefined;
    power: number;
    thunderHover: (Point & { local?: boolean }) | undefined;
    bricks: number;
    blocks: ReadonlyArray<
      Point & { local?: boolean; thunder?: boolean; active?: boolean }
    >;
    checkpoint: Point;
    invalid: boolean;
    run: {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    } | undefined;
    onFinish: () => void;
    grid: boolean[][];
    onSlow: (thunder: Point & { local?: boolean }) => void;
    date: number;
  },
) => {
  const zooming = touching && time > 0;
  // Only pan the camera (animate transform-origin) once we're already zoomed
  // in, i.e. dragging the block a step. On the initial tap-to-zoom the origin
  // jumps instantly so it zooms straight into the tapped point instead of
  // panning across the board.
  const wasZooming = useRef(false);
  const panCamera = zooming && wasZooming.current;
  useEffect(() => {
    wasZooming.current = zooming;
  });

  // A grabbed block being dragged: its origin is hidden and the block itself
  // (not a faded placement ghost) follows the pointer at `placingBlock`.
  const dragging = !!transitionBlock && placingBlock.placing;

  return (
    <div
      style={{
        maxWidth: "var(--maze-size)",
        margin: "0 auto",
      }}
    >
      <svg
        style={{
          width: "100%",
          display: "block",
          // Disable iOS double-tap-to-zoom on the board so taps on interactive
          // text (e.g. "Ready?") activate instead of zooming. body's
          // `touch-action: none` isn't inherited by the SVG, `user-scalable=no`
          // is ignored by iOS Safari, and the gameplay handlers preventDefault
          // only for non-text targets — leaving the text unprotected.
          touchAction: "manipulation",
          // Animate the scale, and the origin too while dragging so the camera
          // pans in step with the block (avoids the block gliding while the
          // camera snaps). On the initial zoom the origin isn't animated (see
          // panCamera) so it zooms straight into the tapped point.
          transition: panCamera
            ? "transform 100ms, transform-origin 100ms"
            : "transform 100ms",
          transformOrigin: `${(placingBlock.x + 1) * 5}% ${
            placingBlock.y * 5
          }%`,
          transform: zooming ? "scale(2)" : undefined,
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
        {transitionBlock && (power > 0 || transitionBlock.thunder) &&
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
            🧱 {bricks}
          </text>
        )}
        {power >= 0 && (
          <text x={3.4} y={0.8} font-size={0.8} fill="var(--maze-text)">
            ❄️ {power}
          </text>
        )}
        <TopRight time={time} hasResources={bricks > 0 || power > 0} />
        <BottomRight />
        {!Number.isNaN(date) && (
          <text x={1.2} y={19.75} font-size={0.8} fill="var(--maze-text)">
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(
              new Date(date),
            )}
          </text>
        )}

        {blocks.map((block) => {
          // The grabbed block is drawn invisibly (not removed) while dragging:
          // the real block follows the pointer via `placingBlock`, but keeping
          // this node in the DOM preserves the touch's target so touchmove /
          // touchend keep firing on mobile (they're anchored to the start node).
          const hidden = dragging && block === transitionBlock;
          return (
            <>
              <Block
                x={block.x}
                y={block.y}
                color={block.thunder
                  ? block.local ? "player-thunder" : "game-thunder"
                  : transitionBlock === block && power > 0
                  ? "upgrade-to-thunder"
                  : block.local
                  ? "player-block"
                  : "game-block"}
                opacity={hidden
                  ? 0
                  : block.thunder
                  ? transitionBlock === block ? 0.4 : 1
                  : transitionBlock === block && power === 0
                  ? 0.6
                  : undefined}
              />
              {block.active && !hidden && (
                <circle
                  cx={block.x + 1}
                  cy={block.y + 1}
                  fill="var(--maze-thunder-radius)"
                  r={4}
                  z-index={1}
                />
              )}
            </>
          );
        })}
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
            color={invalid
              ? "placing-error"
              : dragging
              ? transitionBlock?.thunder ? "player-thunder" : "player-block"
              : "placing-block"}
            opacity={dragging ? (invalid ? 0.5 : 1) : 0.4}
            style={{ transition: "x 100ms, y 100ms" }}
          />
        )}
        {run && time < 0 && (
          <>
            <text
              x={18.8}
              y={0.8}
              font-size={0.8}
              fill="var(--maze-text)"
              text-anchor="end"
            >
              <Timer to={run.duration} /> seconds
            </text>
            <Runner
              {...run}
              onFinish={onFinish}
              onSlow={(thunder) =>
                onSlow(
                  blocks.find((t) => thunder.x === t.x && thunder.y === t.y)!,
                )}
            />
          </>
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
    </div>
  );
};
