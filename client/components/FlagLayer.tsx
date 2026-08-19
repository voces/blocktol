import { Fragment, h, JSX } from "preact";
import { useRef, useState } from "preact/compat";
import type { Point } from "../../common/types.ts";
import {
  armTouchZoom,
  clearTouchZoom,
  placingBlock,
} from "./Game/interaction.ts";
import { getSettings } from "../hooks/useSettings.ts";
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
  // The gesture in progress. `index` is the flag being dragged, or -1 while
  // placing a NEW one — which is a press on empty ground, previewed from the
  // instant the pointer lands and committed on release, exactly the way a block
  // is placed. `clientX/Y` is the press point, for the slop test.
  const drag = useRef<
    {
      index: number;
      clientX: number;
      clientY: number;
      moved: boolean;
      // The cell the preview is on. Release commits THIS, never a fresh mapping
      // of the release point — the same contract the block placement has (see
      // useInputEnd, which places at `placingBlock`): what you can see is where
      // it lands, even mid zoom animation, where the board's box is still
      // moving under the pointer.
      cell: Point;
    } | null
  >(null);
  // Where the dragged (or about-to-be-placed) flag currently sits, so it
  // follows the pointer.
  const [preview, setPreview] = useState<{ index: number } & Point | null>(
    null,
  );
  // The scrim owns the pointer for the whole gesture, whether it started on
  // empty ground or on a flag: it's one element that outlives every placement,
  // so a capture taken here can't be lost when the flag under the finger is
  // re-rendered.
  const scrim = useRef<SVGRectElement>(null);
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

  // Take the gesture: capture the pointer on the scrim and, on touch, arm the
  // placing zoom on the player's configured delay — the same magnification a
  // block placement gets, so a finger doesn't have to cover the cell it is
  // aiming at. `placingBlock` is the camera origin the board zooms about
  // (`placing` stays false, so no block ghost is drawn).
  const take = (
    e: JSX.TargetedPointerEvent<SVGElement>,
    index: number,
    cell: Point,
  ) => {
    e.stopPropagation();
    try {
      scrim.current?.setPointerCapture(e.pointerId);
    } catch { /* capture unavailable (synthetic event) */ }
    drag.current = {
      index,
      clientX: e.clientX,
      clientY: e.clientY,
      moved: false,
      cell,
    };
    placingBlock.value = { ...placingBlock.peek(), x: cell.x, y: cell.y };
    if (e.pointerType === "touch") armTouchZoom(getSettings().zoomDelay);
  };

  // Press on empty ground: the flag appears AT ONCE, previewed under the
  // pointer, and is only written on release — a block placement, with a flag.
  const startPlace = (e: JSX.TargetedPointerEvent<SVGElement>) => {
    if (!armed || drag.current) return;
    const cell = cellAt(e);
    if (occupied(cell) || flags.length >= MAX_FLAGS) return;
    take(e, -1, cell);
    setPreview({ index: -1, ...cell });
  };

  const startGrab =
    (index: number) => (e: JSX.TargetedPointerEvent<SVGElement>) => {
      if (!armed) return;
      take(e, index, flags[index]);
    };

  const move = (e: JSX.TargetedPointerEvent<SVGElement>) => {
    const held = drag.current;
    if (!held) return;
    const dx = e.clientX - held.clientX;
    const dy = e.clientY - held.clientY;
    // A new flag tracks the pointer from the first move; an existing one only
    // once the press has really travelled, so a tap that wobbles still reads as
    // a tap (and a tap on a flag clears it).
    if (
      held.index >= 0 && !held.moved && dx * dx + dy * dy <= DRAG_SLOP ** 2
    ) return;
    held.moved = true;
    held.cell = cellAt(e);
    placingBlock.value = {
      ...placingBlock.peek(),
      x: held.cell.x,
      y: held.cell.y,
    };
    setPreview({ index: held.index, ...held.cell });
  };

  const release = (e: JSX.TargetedPointerEvent<SVGElement>) => {
    const held = drag.current;
    if (!held) return;
    e.stopPropagation();
    drag.current = null;
    setPreview(null);
    clearTouchZoom();
    const cell = held.cell;
    // A new flag lands where its preview stood, unless something is already
    // there (the preview simply evaporates then, like a block dropped on an
    // occupied cell).
    if (held.index < 0) {
      if (!occupied(cell)) onChange([...flags, cell]);
      return;
    }
    // An existing flag that never left its cell → a tap, which clears it.
    // Moved → drop it there, unless another flag holds the cell (snap back).
    if (!held.moved) {
      onChange(flags.filter((_, i) => i !== held.index));
      return;
    }
    if (occupied(cell, held.index)) return;
    onChange(flags.map((f, i) => i === held.index ? cell : f));
  };

  // The gesture was taken away (a system gesture, a second finger): drop the
  // preview without writing anything.
  const cancel = () => {
    drag.current = null;
    setPreview(null);
    clearTouchZoom();
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
            ref={scrim}
            class="flag-layer__scrim"
            x={1}
            y={1}
            width={18}
            height={18}
            fill="transparent"
            onPointerDown={startPlace}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={cancel}
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
      {
        /* A flag being placed: drawn from the moment the pointer lands, so the
          gesture reads the way a block placement does, and faded until release
          because nothing is written until then. */
      }
      {preview?.index === -1 && (
        <path
          class="flag__pennant flag__pennant--placing"
          d={pennant(preview.x, preview.y)}
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
                onPointerDown={startGrab(index)}
              />
            )}
          </g>
        );
      })}
    </>
  );
};
