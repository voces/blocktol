import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath } from "../../../common/pathing.ts";
import { isBorderPoint, isInvalidMove, isTouchSource } from "./helpers.ts";
import { GameStateContext } from "./useGameState.ts";

export const useInputStart = (svg: SVGSVGElement | null) => {
  const {
    time,
    blocks,
    setPlacingBlock,
    bricks,
    checkpoint,
    grid,
    setInvalid,
    setThunderHover,
    setTransitionBlock,
    setTouching,
    dragRef,
    setDragMoved,
  } = useContext(GameStateContext);

  useEffect(() => {
    // `press` is a pointer/touch down: if it lands on a local block we grab it
    // to drag; otherwise it (and subsequent moves) position a placement preview.
    const callback = (clientX: number, clientY: number, press = false) => {
      if (!svg || time <= 0) return;

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

      // Grab a local block on press, remembering the pressed cell so a tap
      // (no cell change) doesn't move it.
      if (press) {
        dragRef.current = overlap?.local
          ? { origin: overlap, dragged: false, startX: x, startY: y }
          : null;
      }

      const drag = dragRef.current;
      if (drag) {
        // Sticky: once the pointer leaves the cell it pressed, it's a move.
        if (x !== drag.startX || y !== drag.startY) drag.dragged = true;
        // Mirror the sticky flag so the board drops the upgrade radius for the
        // rest of the drag — including a drag back onto the origin cell.
        setDragMoved(drag.dragged);
        // Center the block on the pointer once dragging (same mapping as
        // placing a new block); keep it put until then so a tap doesn't nudge.
        const tx = drag.dragged ? x : drag.origin.x;
        const ty = drag.dragged ? y : drag.origin.y;
        const atOrigin = tx === drag.origin.x && ty === drag.origin.y;
        setTransitionBlock(drag.origin);
        setThunderHover(undefined);
        setPlacingBlock(() => ({ placing: true, x: tx, y: ty }));
        setInvalid(
          !atOrigin && isInvalidMove(grid, checkpoint, drag.origin, tx, ty),
        );
        return;
      }

      // Not dragging (a hover or a fresh press): the upgrade radius is free to
      // show again on the next grab.
      setDragMoved(false);

      setPlacingBlock(() => ({ placing: !overlap?.local && bricks > 0, x, y }));

      let invalid = (!!overlap && !overlap.local) ||
        (Math.abs(checkpoint.x - x) + Math.abs(checkpoint.y - y)) <= 1;
      if (
        !invalid && !overlap &&
        (offsets.every(([xd, yd]) => !grid[y + yd][x + xd]))
      ) {
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
        try {
          if (!findPath(grid, checkpoint)) invalid = true;
        } catch (err) {
          console.error(err);
        }
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
      }

      setInvalid(invalid);

      if (overlap && !overlap.local && overlap.thunder) {
        setThunderHover(overlap);
      } else {
        setThunderHover(undefined);
      }

      setTransitionBlock(
        overlap?.local ? overlap : undefined,
      );
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
      setTouching(true);
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
  }, [svg, bricks, blocks, checkpoint, time]);
};
