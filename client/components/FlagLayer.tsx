import { Fragment, h, JSX } from "preact";
import { useRef, useState } from "preact/compat";
import type { Point } from "../../common/types.ts";
import { flagKey, hoveredSplit, liveFlags } from "../store/flags.ts";

// Same slop the block drag uses (see useInputStart): a flag only MOVES once the
// pointer has really travelled, so a tap that wobbles still reads as a tap —
// and a tap clears the flag.
const DRAG_SLOP = 12;

// The play area is the board minus its wall ring.
const clampCell = (n: number) => Math.min(Math.max(Math.floor(n), 1), 18);

// Well past any sane use of the feature, and the same bound the server's
// setFlags validation applies — so the UI refuses the 41st rather than letting
// the write come back rejected.
const MAX_FLAGS = 40;

// A pennant on a pole, planted in the centre of its cell and flying up out of
// it. Orange: the one hue the maze palette leaves free (see the design tokens).
const pennant = (x: number, y: number) =>
  `M${x + 0.5} ${y + 0.5}V${y - 1.1}h1.1l-.32.5.32.5H${x + 0.5}`;

/**
 * Flags on the board: the splits tape's manual checkpoints.
 *
 * Drawn always (they belong to the board, so they stay put across runs and
 * reviews) and interactive only while placement is ARMED from the splits panel
 * — with the board visible a bare tap is ambiguous, so arming is what tells a
 * flag tap apart from inspecting a thunder. While armed the board dims behind a
 * scrim (the checkpoint is redrawn on top so it stays legible) and every cell
 * takes a flag; a flag itself drags to move and taps to clear.
 *
 * A flag the current run doesn't cross reports nothing, and draws as a dashed
 * outline — a speculative mark waiting for a build that routes the runner past
 * it.
 */
export const FlagLayer = (
  { flags, armed, checkpoint, onChange }: {
    flags: ReadonlyArray<Point>;
    armed: boolean;
    checkpoint: Point;
    onChange: (flags: Point[]) => void;
  },
) => {
  // The in-progress grab: which flag, where the pointer went down (screen
  // pixels, for the slop test), and whether it has become a move.
  const drag = useRef<
    { index: number; clientX: number; clientY: number; moved: boolean } | null
  >(null);
  // Where the grabbed flag currently sits, so it follows the pointer.
  const [preview, setPreview] = useState<{ index: number } & Point | null>(
    null,
  );
  const live = liveFlags.value;
  const hovered = hoveredSplit.value;

  const cellAt = (e: JSX.TargetedPointerEvent<SVGElement>): Point => {
    const svg = e.currentTarget.ownerSVGElement ?? e.currentTarget;
    const box = svg.getBoundingClientRect();
    return {
      x: clampCell((e.clientX - box.x) / box.width * 20),
      y: clampCell((e.clientY - box.y) / box.height * 20),
    };
  };

  const occupied = (cell: Point, ignore?: number) =>
    flags.some((f, i) => i !== ignore && f.x === cell.x && f.y === cell.y);

  const addFlag = (e: JSX.TargetedPointerEvent<SVGElement>) => {
    if (drag.current) return;
    const cell = cellAt(e);
    if (occupied(cell) || flags.length >= MAX_FLAGS) return;
    onChange([...flags, cell]);
  };

  const grab = (index: number) => (e: JSX.TargetedPointerEvent<SVGElement>) => {
    if (!armed) return;
    // Keep the press from also reaching the scrim below, which would drop a
    // second flag on release.
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* capture unavailable (synthetic event) */ }
    drag.current = {
      index,
      clientX: e.clientX,
      clientY: e.clientY,
      moved: false,
    };
  };

  const move = (e: JSX.TargetedPointerEvent<SVGElement>) => {
    const held = drag.current;
    if (!held) return;
    const dx = e.clientX - held.clientX;
    const dy = e.clientY - held.clientY;
    if (!held.moved && dx * dx + dy * dy <= DRAG_SLOP * DRAG_SLOP) return;
    held.moved = true;
    setPreview({ index: held.index, ...cellAt(e) });
  };

  const release = (e: JSX.TargetedPointerEvent<SVGElement>) => {
    const held = drag.current;
    if (!held) return;
    e.stopPropagation();
    drag.current = null;
    setPreview(null);
    // Never left its cell → a tap, which clears the flag. Moved → drop it
    // there, unless another flag already holds the cell (then it snaps back).
    if (!held.moved) {
      onChange(flags.filter((_, i) => i !== held.index));
      return;
    }
    const cell = cellAt(e);
    if (occupied(cell, held.index)) return;
    onChange(flags.map((f, i) => i === held.index ? cell : f));
  };

  return (
    <>
      {armed && (
        <>
          {
            /* Dim the pieces so the flags (and where they could go) read as the
              subject; the checkpoint is redrawn above the scrim because a route
              without it visible is unreadable. */
          }
          <rect
            x={1}
            y={1}
            width={18}
            height={18}
            fill="var(--maze-background)"
            opacity={0.62}
          />
          <rect
            x={checkpoint.x + 0.55}
            y={checkpoint.y + 0.55}
            rx={0.06}
            width={0.9}
            height={0.9}
            fill="var(--maze-checkpoint)"
          />
          {
            /* The placement surface: any cell of the play area takes a flag.
              It sits under the flags themselves, so a press on one of those is
              a grab, not a second flag. */
          }
          <rect
            class="flag-layer__scrim"
            x={1}
            y={1}
            width={18}
            height={18}
            fill="transparent"
            onPointerUp={addFlag}
          />
        </>
      )}
      {hovered && (
        <rect
          class="flag-layer__hover"
          x={hovered.x}
          y={hovered.y}
          width={hovered.size}
          height={hovered.size}
          rx={0.06}
        />
      )}
      {flags.map((flag, index) => {
        const at = preview?.index === index ? preview : flag;
        // No tape up (`live` undefined) means there is no run to judge this
        // flag against — draw it plainly rather than as a dead mark.
        const speculative = !!live && !live.has(flagKey(flag));
        return (
          <g key={flagKey(flag)}>
            {speculative && (
              <rect
                class="flag__cell"
                x={at.x}
                y={at.y}
                width={1}
                height={1}
                rx={0.06}
              />
            )}
            <path
              class={"flag__pennant" +
                (speculative ? " flag__pennant--speculative" : "")}
              d={pennant(at.x, at.y)}
            />
            {armed && (
              // A pennant is a thin stroke; the grab target is the cell it's
              // planted in plus the pole above it. Only while armed, so a flag
              // never swallows a board tap the rest of the time.
              <rect
                class="flag__grab"
                x={at.x - 0.2}
                y={at.y - 1.3}
                width={1.5}
                height={2}
                fill="transparent"
                onPointerDown={grab(index)}
                onPointerMove={move}
                onPointerUp={release}
                onPointerCancel={release}
              />
            )}
          </g>
        );
      })}
    </>
  );
};
