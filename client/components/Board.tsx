import { Fragment, h, Ref } from "preact";
import { useEffect, useMemo, useRef } from "preact/compat";

import { Runner } from "./Runner.tsx";
import { Block } from "./Block.tsx";
import { FlagLayer } from "./FlagLayer.tsx";
import { debug } from "../util/debug.ts";
import { Point } from "../../common/types.ts";
import { useSettings } from "../hooks/useSettings.ts";

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
    run: {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    } | undefined;
    onFinish: () => void;
    grid: boolean[][];
    onSlow: (thunder: Point & { local?: boolean }) => void;
    date: number;
    // Optional: the intro board never reverts, so it has no ghosts to show.
    implosions?: ReadonlyArray<Point & { id: number; thunder?: boolean }>;
    // Optional: the player's splits flags, and whether placing one is armed.
    // Absent on the intro board and during a ranked daily (there are no splits
    // to mark up there) — see FlagLayer.
    flags?: ReadonlyArray<Point>;
    flagsArmed?: boolean;
    onFlagsChange?: (flags: Point[]) => void;
  },
) => {
  // Board magnification while placing (touch). A 1× setting disables it — the
  // board never scales — so it behaves as if the zoom feature isn't there.
  const { settings } = useSettings();
  const zoom = settings.zoom;
  const zooming = touching && time > 0 && zoom > 1;
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

  // Static graph-paper grid. Memoized to a stable vnode so Preact doesn't
  // rebuild these 18 lines on every re-render of the board.
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
          /* The entrance/exit notches (x 9–11) break the wall band; carry the
            centre grid line (x=10) up and down through them so the graph paper
            continues into the openings rather than stopping at the playfield. */
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
          // Static styling (rounding, font, touch-action) lives in
          // `.board-frame > svg`; only the zoom transform is dynamic.
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
          collapse where each one stood, so the rollback reads as deliberate.
          Visual only — no pointer interaction; they self-clear from state. */
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
