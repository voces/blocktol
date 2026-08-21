import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import {
  isBorderPoint,
  isInvalidMove,
  isTouchSource,
  solvable,
} from "./helpers.ts";
import {
  armTouchZoom,
  dragMoved,
  invalid as invalidSignal,
  placingBlock,
  thunderHover,
  transitionBlock,
} from "./interaction.ts";
import { GameStateContext } from "./useGameState.ts";
import { getSettings } from "../../hooks/useSettings.ts";

// How far (in screen pixels) a grabbed block's pointer must travel before the
// grab becomes a move rather than a tap. A tap upgrades to thunder or deletes
// (see useInputEnd), so a little slop here keeps a straight tap from nudging the
// block — especially on touch, where the placing zoom slides the board under the
// finger and would otherwise register as a move.
const DRAG_SLOP = 12;

export const useInputStart = (svg: SVGSVGElement | null) => {
  const {
    timeRef,
    blocksRef,
    budgetNow,
    checkpoint,
    grid,
    dragRef,
    placingRef,
    viewing,
  } = useContext(GameStateContext);

  useEffect(() => {
    // `press` is a pointer/touch down: if it lands on a local block we grab it
    // to drag; otherwise it (and subsequent moves) position a placement preview.
    // `viewing` is checked explicitly (below, once the hovered cell is known): a
    // reviewed maze keeps a live free-play build's countdown on the clock
    // (time > 0), but the board must stay inert — bar the thunder radii, which
    // are the point of studying a maze.
    const callback = (clientX: number, clientY: number, press = false) => {
      if (!svg || (!viewing && timeRef.current <= 0)) return;

      // The board and the budget as they stand right now: a press arriving
      // within a frame of the previous gesture's edit still runs on the closure
      // this effect was registered with, and a grab resolved against that stale
      // board pointed at a block the board no longer holds (see useInputEnd).
      const blocks = blocksRef.current;
      const { bricks } = budgetNow();

      const box = svg.getBoundingClientRect();
      const xRaw = Math.min(
        Math.max((clientX - box.x) / box.width * 20 - 1, 1),
        17,
      );
      const yRaw = Math.min(
        Math.max((clientY - box.y) / box.height * 20 - 1, 1),
        17,
      );
      const x = Math.min(
        Math.max(
          Math.round((clientX - box.x) / box.width * 20) - 1,
          1,
        ),
        17,
      );
      const y = Math.min(
        Math.max(
          Math.round((clientY - box.y) / box.height * 20) - 1,
          1,
        ),
        17,
      );

      const nearest = blocks.reduce<[number, typeof blocks[number]]>(
        (prev, block) => {
          const dist = Math.abs(block.x - xRaw) + Math.abs(block.y - yRaw);
          if (dist < prev[0]) return [dist, block];
          return prev;
        },
        [Infinity, blocks[0]],
      )[1];
      const overlap =
        nearest && Math.abs(nearest.x - x) <= 1 && Math.abs(nearest.y - y) <= 1
          ? nearest
          : undefined;

      // Reviewing: nothing is placeable, so the only thing a pointer does is
      // reveal a thunder's radius — the day's pieces and the reviewed maze's
      // alike (mid-build a hover over your OWN thunder shows the radius through
      // `transitionBlock` instead, which also previews the upgrade).
      if (viewing) {
        thunderHover.value = overlap?.thunder ? overlap : undefined;
        return;
      }

      // Grab a local block on press, remembering the pressed cell and pixel
      // point so a tap (no real movement) doesn't move it.
      if (press) {
        dragRef.current = overlap?.local
          ? {
            origin: overlap,
            dragged: false,
            startX: x,
            startY: y,
            startClientX: clientX,
            startClientY: clientY,
          }
          : null;
        // Pressing an empty cell with bricks in hand starts a placement; keep
        // that in scope so dragging the preview over an existing block reads as
        // an invalid spot rather than a tap-to-upgrade.
        placingRef.current = !overlap?.local && bricks > 0;
      }

      const drag = dragRef.current;
      if (drag) {
        // Sticky start: it's only a move once the pointer both leaves the cell
        // it pressed AND travels past DRAG_SLOP screen pixels. The pixel gate
        // absorbs a slightly off-centre tap and, crucially, the shift the
        // placing zoom slides under a held finger (which changes the mapped cell
        // without the finger really moving) — so straight upgrades/deletes land.
        if (!drag.dragged) {
          const dx = clientX - drag.startClientX;
          const dy = clientY - drag.startClientY;
          if (
            (x !== drag.startX || y !== drag.startY) &&
            dx * dx + dy * dy > DRAG_SLOP * DRAG_SLOP
          ) {
            drag.dragged = true;
          }
        }
        // Mirror the sticky flag so the board drops the upgrade radius for the
        // rest of the drag — including a drag back onto the origin cell.
        dragMoved.value = drag.dragged;
        // Center the block on the pointer once dragging (same mapping as
        // placing a new block); keep it put until then so a tap doesn't nudge.
        const tx = drag.dragged ? x : drag.origin.x;
        const ty = drag.dragged ? y : drag.origin.y;
        const atOrigin = tx === drag.origin.x && ty === drag.origin.y;
        transitionBlock.value = drag.origin;
        thunderHover.value = undefined;
        placingBlock.value = { placing: true, x: tx, y: ty };
        invalidSignal.value = !atOrigin &&
          isInvalidMove(grid, blocks, checkpoint, drag.origin, tx, ty);
        return;
      }

      // Not dragging (a hover or a fresh press): the upgrade radius is free to
      // show again on the next grab.
      dragMoved.value = false;

      // Mid-placement, keep the preview visible over any block (it'll be red —
      // you can't stack there). A bare hover instead hides the preview over your
      // own block so its tap-to-upgrade radius reads clearly.
      const placing = placingRef.current;
      placingBlock.value = {
        placing: (placing || !overlap?.local) && bricks > 0,
        x,
        y,
      };

      let invalid = (!!overlap && (placing || !overlap.local)) ||
        (Math.abs(checkpoint.x - x) + Math.abs(checkpoint.y - y)) <= 1;
      if (
        !invalid && !overlap &&
        (offsets.every(([xd, yd]) => !grid[y + yd][x + xd]))
      ) {
        invalid = !solvable(blocks, checkpoint, { x, y });
      }

      invalidSignal.value = invalid;

      thunderHover.value = overlap && !overlap.local && overlap.thunder
        ? overlap
        : undefined;

      // A bare hover over your own block previews the tap-to-upgrade radius; a
      // placement dragged over it doesn't — the block can't go there, so no
      // upgrade is implied.
      transitionBlock.value = !placing && overlap?.local ? overlap : undefined;
    };

    const mousemoveCallback = (e: MouseEvent) => {
      if (isTouchSource(e)) return;
      callback(e.clientX, e.clientY);
    };
    globalThis.addEventListener("mousemove", mousemoveCallback);

    const mousedownCallback = (e: MouseEvent) => {
      if (isTouchSource(e)) return;
      if (!(e.target instanceof SVGElement)) return;
      callback(e.clientX, e.clientY, true);
    };
    globalThis.addEventListener("mousedown", mousedownCallback);

    const touchmoveCallback = (e: TouchEvent) => {
      const target = e.changedTouches[0].target;
      if (!(target instanceof SVGElement) || target instanceof SVGTextElement) {
        return;
      }
      e.preventDefault();
      const touch = e.touches[0];
      if (isBorderPoint(svg, touch.clientX, touch.clientY)) return;
      callback(touch.clientX, touch.clientY);
    };
    globalThis.addEventListener("touchmove", touchmoveCallback, {
      passive: false,
    });

    const touchstartCallback = (e: TouchEvent) => {
      const target = e.changedTouches[0].target;
      if (!(target instanceof SVGElement) || target instanceof SVGTextElement) {
        return;
      }
      const touch = e.touches[0];
      // Ignore taps on the board's border/wall band so they don't zoom or
      // place blocks — that ring holds the HUD controls (Ready?, best score).
      if (isBorderPoint(svg, touch.clientX, touch.clientY)) return;
      // An inert reviewed maze doesn't zoom (`touching` drives the placing zoom,
      // which keys off time > 0 — live during a view now), but the tap still
      // goes through: with no hover on touch, tapping a thunder is how you see
      // its radius while studying a maze. It stays up until you tap elsewhere —
      // the release path leaves it alone while viewing.
      // Otherwise arm the zoom on the player's configured delay (read
      // non-reactively so the listeners don't re-register per setting change) —
      // 0 zooms at once, a larger value lets a quick tap-to-place land before
      // the board magnifies.
      if (!viewing) armTouchZoom(getSettings().zoomDelay);
      callback(touch.clientX, touch.clientY, true);
      e.preventDefault();
    };
    globalThis.addEventListener("touchstart", touchstartCallback);

    return () => {
      globalThis.removeEventListener("mousemove", mousemoveCallback);
      globalThis.removeEventListener("mousedown", mousedownCallback);
      globalThis.removeEventListener("touchstart", touchstartCallback);
      globalThis.removeEventListener("touchmove", touchmoveCallback);
    };
    // The clock, the board and the budget are read through refs/signals, so the
    // listeners only re-register when what a gesture MEANS changes — never per
    // edit.
  }, [svg, checkpoint, viewing]);
};
