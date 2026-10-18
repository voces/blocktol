import { Fragment, h, Ref } from "preact";
import { useEffect, useMemo, useRef } from "preact/compat";

import { Runner } from "./Runner.tsx";
import { Block } from "./Block.tsx";
import { FlagLayer } from "./FlagLayer.tsx";
import { debug } from "../util/debug.ts";
import { Point } from "../../common/types.ts";
import { useSettings } from "../hooks/useSettings.ts";
import { intlLocale } from "../util/t.ts";

export const Board = (
  {
    placingBlock,
    touching,
    time,
    svgRef,
    transitionBlock,
    power,
    thunderHover,
    blocks,
    checkpoint,
    invalid,
    run,
    paused,
    onFinish,
    grid,
    onSlow,
    date,
    dragMoved,
    implosions,
    flags,
    flagsArmed,
    onFlagsChange,
  }: {
    placingBlock: Point & { placing: boolean };
    touching: boolean;
    time: number;
    svgRef: Ref<SVGSVGElement>;
    transitionBlock:
      | Point & { local?: boolean; thunder?: boolean; active?: boolean }
      | undefined;
    power: number;
    dragMoved: boolean;
    thunderHover: (Point & { local?: boolean }) | undefined;
    blocks: ReadonlyArray<
      Point & { local?: boolean; thunder?: boolean; active?: boolean }
    >;
    checkpoint: Point;
    invalid: boolean;
    // Holds the runner in place (the intro tour's spawn beat and checkpoint
    // stop). Undefined elsewhere, so a live run never pauses.
    paused?: boolean;
    run: {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    } | undefined;
    onFinish: () => void;
    grid: boolean[][];
    onSlow: (thunder: Point & { local?: boolean }) => void;
    date: number;
    // Optional: the intro board never reverts, so it has no ghosts.
    implosions?: ReadonlyArray<Point & { id: number; thunder?: boolean }>;
    // Optional: the player's splits flags, and whether placing one is armed.
    // Passed only while the splits tape is up (a run being reviewed or
    // animating); absent on the intro board, while building, and in a ranked
    // daily. See FlagLayer.
    flags?: ReadonlyArray<Point>;
    flagsArmed?: boolean;
    onFlagsChange?: (flags: Point[]) => void;
  },
) => {
  // Board magnification while placing (touch); 1× disables it.
  const { settings } = useSettings();
  const zoom = settings.zoom;
  // The placing zoom also serves flag placement, which happens on a REVIEWED
  // board (time < 0).
  const zooming = touching && (time > 0 || !!flagsArmed) && zoom > 1;
  // Animate transform-origin (pan) only once already zoomed in; the initial
  // tap-to-zoom jumps the origin so it zooms straight into the tapped point.
  const wasZooming = useRef(false);
  const panCamera = zooming && wasZooming.current;
  useEffect(() => {
    wasZooming.current = zooming;
  });

  // A grabbed block is being dragged: its origin is hidden and the block itself
  // follows the pointer at `placingBlock`.
  const dragging = !!transitionBlock && placingBlock.placing;

  // Static graph-paper grid, memoized so Preact doesn't rebuild its lines on
  // every board re-render.
  const gridLines = useMemo(
    () => (
      <g stroke="var(--maze-grid)" stroke-width={0.03}>
        {Array.from({ length: 9 }, (_, i) => {
          const n = (i + 1) * 2;
          return (
            <Fragment key={n}>
              <line x1={n} y1={1} x2={n} y2={19} />
              <line x1={1} y1={n} x2={19} y2={n} />
            </Fragment>
          );
        })}
        {
          /* The entrance/exit notches (x 9–11) break the wall band; extend the
            centre grid line (x=10) through them. */
        }
        <line x1={10} y1={0} x2={10} y2={1} />
        <line x1={10} y1={19} x2={10} y2={20} />
      </g>
    ),
    [],
  );

  return (
    <div class="board-frame">
      <svg
        style={{
          // Static styling lives in `.board-frame > svg`; only the zoom
          // transform is dynamic. The origin animates only while panning (see
          // panCamera), so the camera moves in step with a dragged block.
          transition: panCamera
            ? "transform 100ms, transform-origin 100ms"
            : "transform 100ms",
          transformOrigin: `${(placingBlock.x + 1) * 5}% ${
            placingBlock.y * 5
          }%`,
          transform: zooming ? `scale(${zoom})` : undefined,
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
        {gridLines}
        {transitionBlock && !dragMoved &&
          (power > 0 || transitionBlock.thunder) &&
          (
            <circle
              cx={transitionBlock.x + 1}
              cy={transitionBlock.y + 1}
              fill="var(--maze-thunder-radius)"
              r={4}
              z-index={1}
            />
          )}
        {
          /* A hovered thunder's radius. Skipped when it's the piece
            `transitionBlock` already draws a circle for, so the translucent
            fill isn't stacked. A reviewed maze has no transitionBlock, so the
            day's thunders and the maze's both draw here. */
        }
        {thunderHover && thunderHover !== transitionBlock &&
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
        {!Number.isNaN(date) && (
          <text x={1.2} y={19.75} font-size={0.8} fill="var(--maze-text)">
            {new Intl.DateTimeFormat(intlLocale(), {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(
              new Date(date),
            )}
          </text>
        )}

        {blocks.map((block) => {
          // The grabbed block stays in the DOM, invisible, while dragging:
          // touch events stay anchored to the start node, so removing it would
          // stop touchmove / touchend on mobile.
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
            rx={0.06}
            width={0.9}
            height={0.9}
            fill="var(--maze-checkpoint)"
          />
        )}
        {flags && onFlagsChange && (
          <FlagLayer
            flags={flags}
            armed={!!flagsArmed}
            checkpoint={checkpoint}
            onChange={onFlagsChange}
          />
        )}
        {
          /* Ghosts of reverted (never-persisted) blocks: a brief puff-then-
          collapse where each stood. Visual only; they self-clear from state. */
        }
        {implosions?.map((g) => (
          <g key={g.id} class="board-implode">
            <Block
              x={g.x}
              y={g.y}
              color={g.thunder ? "player-thunder" : "player-block"}
            />
          </g>
        ))}
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
          <Runner
            {...run}
            paused={paused}
            onFinish={onFinish}
            onSlow={(thunder) =>
              onSlow(
                blocks.find((t) => thunder.x === t.x && thunder.y === t.y)!,
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
    </div>
  );
};
