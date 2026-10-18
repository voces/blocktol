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

// Same slop as the block drag (see useInputStart): a flag only MOVES once the
// pointer has travelled this far (screen px), so a wobbly tap still clears it.
const DRAG_SLOP = 12;

// The play area is the board minus its wall ring.
const clampCell = (n: number) => Math.min(Math.max(Math.floor(n), 1), 18);

// The bound `setFlags` validation applies (server/routes/iteration/flags.ts),
// so the UI refuses the 41st rather than getting the write rejected.
const MAX_FLAGS = 40;

// How far a pennant's pole rises above its cell, and the tip's clearance from
// the board's edge: half the widest stroke (speculative, 0.13), so the stroke
// ends on the edge rather than past it.
const RISE = 1.1;
const TIP_CLEARANCE = 0.07;

// A pennant on a pole planted in the centre of its cell. Orange: the one hue
// the maze palette leaves free.
//
// The rise is capped at the room above the cell: the viewBox stops at y=0 and
// can't widen (`cellAt` and the input hooks map pointers through
// `box.width / 20`), so a full 1.1 rise in row 1 would clip the pennant's top.
const pennant = (x: number, y: number) => {
  const rise = Math.min(RISE, y - TIP_CLEARANCE);
  return `M${x + 0.5} ${y + 0.5}V${y - rise}h1.1l-.32.5.32.5H${x + 0.5}`;
};

/**
 * Flags on the board: the splits tape's manual checkpoints.
 *
 * Drawn only while the splits tape is up (a run being reviewed or animating;
 * the caller gates this, see Game/index.tsx). Flags belong to the BOARD; only
 * showing them rides with the tape.
 *
 * Interactive only while placement is ARMED from the splits panel, since a bare
 * tap is ambiguous with inspecting a thunder. While armed the board dims behind
 * a scrim (the checkpoint is redrawn on top) and every cell takes a flag; a
 * flag drags to move and taps to clear.
 *
 * A flag the current run doesn't cross reports nothing and draws dashed
 * (speculative).
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
  // placing a NEW one (previewed on press, committed on release, like a block).
  // `clientX/Y` is the press point, for the slop test.
  const drag = useRef<
    {
      index: number;
      clientX: number;
      clientY: number;
      moved: boolean;
      // The cell the preview is on. Release commits THIS, not a fresh mapping
      // of the release point, which is wrong mid zoom animation while the
      // board's box still moves (as in useInputEnd's `placingBlock`).
      cell: Point;
    } | null
  >(null);
  // Where the dragged (or about-to-be-placed) flag sits, following the pointer.
  const [preview, setPreview] = useState<{ index: number } & Point | null>(
    null,
  );
  // The scrim captures the pointer for the whole gesture, even one started on a
  // flag: it outlives re-renders of the flag under the finger.
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
  // placing zoom (after the player's zoomDelay) as a block placement does.
  // `placingBlock` is the camera origin; `placing` stays false, so no block
  // ghost is drawn.
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

  // Press on empty ground: the flag previews at once and is written on release.
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
    // A new flag tracks the pointer at once; an existing one only past the
    // slop, so a wobbly tap on a flag still clears it.
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
    // A new flag lands where its preview stood, unless the cell is occupied
    // (the preview just vanishes, as with a block).
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

  // The gesture was taken away (system gesture, second finger): write nothing.
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
            /* Dim the pieces so the flags read as the subject; the checkpoint
              is redrawn above the scrim to keep the route legible. */
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
            /* The placement surface: any play-area cell takes a flag. It sits
              under the flags, so pressing one grabs it instead. */
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
        /* A flag being placed: drawn on press, faded until release. */
      }
      {preview?.index === -1 && (
        <path
          class="flag__pennant flag__pennant--placing"
          d={pennant(preview.x, preview.y)}
        />
      )}
      {flags.map((flag, index) => {
        const at = preview?.index === index ? preview : flag;
        // `live` is set whenever this layer is drawn; the guard only stops a
        // set-less render from marking every flag speculative.
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
              // A pennant is a thin stroke, so the grab target is its cell plus
              // the pole above. Armed only, so it never swallows a board tap.
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
