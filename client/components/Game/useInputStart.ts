import { useContext, useEffect } from "preact/compat";
import { pieceOverlaps } from "../../../common/grid.ts";
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

// Screen pixels a grabbed block's pointer must travel before the grab becomes
// a move rather than a tap (see useInputEnd). Matters on touch, where the
// placing zoom slides the board under the finger.
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
    // `press` is a pointer/touch down: on a local block it grabs it to drag,
    // otherwise it (and later moves) positions a placement preview. `viewing`
    // is checked explicitly (below): a review can keep a live free-play
    // countdown (time > 0), but the board stays inert bar thunder radii.
    const callback = (clientX: number, clientY: number, press = false) => {
      if (!svg || (!viewing && timeRef.current <= 0)) return;

      // The board and budget right now, not this effect's closure: a stale
      // board can resolve a grab to a block that is gone (see useInputEnd).
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

      const nearest =
        blocks.reduce<[number, typeof blocks[number] | undefined]>(
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

      // Reviewing: the pointer only reveals a thunder's radius, the day's and
      // the reviewed maze's alike. (Mid-build, your OWN thunder shows it via
      // `transitionBlock`, which also previews the upgrade.)
      if (viewing) {
        thunderHover.value = overlap?.thunder ? overlap : undefined;
        return;
      }

      // Grab a local block on press, remembering the pressed cell and pixel
      // point so a tap doesn't move it.
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
        // Pressing an empty cell with bricks in hand starts a placement, so
        // dragging the preview over a block reads as invalid, not an upgrade.
        placingRef.current = !overlap?.local && bricks > 0;
      }

      const drag = dragRef.current;
      if (drag) {
        // Sticky: a move only once the pointer leaves its pressed cell AND
        // travels past DRAG_SLOP pixels. The pixel gate absorbs an off-centre
        // tap and the placing zoom's shift under a held finger, which changes
        // the mapped cell without the finger moving.
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
        // Mirrored so the board drops the upgrade radius for the rest of the
        // drag, even back on the origin cell.
        dragMoved.value = drag.dragged;
        // Follow the pointer once dragging (as placing does); stay put before.
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

      dragMoved.value = false;

      // Mid-placement the preview stays visible over any block (red: no
      // stacking). A bare hover hides it over your own block so the
      // tap-to-upgrade radius reads clearly.
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
        !pieceOverlaps(grid, { x, y })
      ) {
        invalid = !solvable(blocks, checkpoint, { x, y });
      }

      invalidSignal.value = invalid;

      thunderHover.value = overlap && !overlap.local && overlap.thunder
        ? overlap
        : undefined;

      // A bare hover over your own block previews the upgrade radius; a
      // placement dragged over it doesn't, as no upgrade is implied.
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
      const target = e.changedTouches.item(0)?.target;
      if (!(target instanceof SVGElement) || target instanceof SVGTextElement) {
        return;
      }
      e.preventDefault();
      const touch = e.touches.item(0);
      if (!touch) return;
      if (isBorderPoint(svg, touch.clientX, touch.clientY)) return;
      callback(touch.clientX, touch.clientY);
    };
    globalThis.addEventListener("touchmove", touchmoveCallback, {
      passive: false,
    });

    const touchstartCallback = (e: TouchEvent) => {
      const target = e.changedTouches.item(0)?.target;
      if (!(target instanceof SVGElement) || target instanceof SVGTextElement) {
        return;
      }
      const touch = e.touches.item(0);
      if (!touch) return;
      // Ignore taps on the border band: it holds the HUD controls (Ready?, best
      // score).
      if (isBorderPoint(svg, touch.clientX, touch.clientY)) return;
      // A review doesn't zoom (the placing zoom keys off time > 0, which can be
      // live during a view), but the tap still goes through: with no hover on
      // touch, tapping a thunder is how its radius shows, and it stays up until
      // you tap elsewhere (the release path leaves it alone while viewing).
      // Otherwise arm the zoom on the configured delay, read non-reactively so
      // a setting change doesn't re-register the listeners.
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
    // The clock, board and budget are read through refs/signals, so listeners
    // re-register only when what a gesture MEANS changes, never per edit.
  }, [svg, checkpoint, viewing]);
};
