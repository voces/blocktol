import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath } from "../../../common/pathing.ts";
import { Point } from "../../../common/types.ts";
import { startBoardRun } from "../../store/board.ts";
import {
  placingBlock,
  thunderHover,
  touching,
  transitionBlock,
} from "./interaction.ts";
import { saveRun } from "./runSaver.ts";
import {
  isBorderPoint,
  isInvalidMove,
  isTouchSource,
  rebuildGrid,
} from "./helpers.ts";
import { GameStateContext } from "./useGameState.ts";

export const useInputEnd = (svg: SVGSVGElement | null) => {
  const {
    timeRef,
    checkpoint,
    grid,
    blocks,
    setBlocks,
    power,
    setPower,
    setBricks,
    bricks,
    dragRef,
    placingRef,
    iteration,
    staged,
    setStaged,
  } = useContext(GameStateContext);

  useEffect(() => {
    // Apply a new block list: persist via the run saver (serialized, retried,
    // reconciled by useInit's handlers), rebuild the pathing grid, and set
    // state. Effectful work stays OUT of the setBlocks updater — updaters are
    // contractually pure, and a double-invoked updater would double-fire the
    // save. `blocks` from the render closure is fresh: the effect re-registers
    // on it, and each gesture applies at most one edit.
    const apply = (newBlocks: typeof blocks) => {
      saveRun({
        iteration: iteration ?? -1,
        blocks: newBlocks.filter((b) => b.local),
      });
      rebuildGrid(grid, checkpoint, newBlocks);
      setBlocks(newBlocks);
    };

    // Remove a local block, refunding its brick (and power, if it was a
    // thunder). Shared by a tap-delete and by dragging a block somewhere it
    // can't be placed.
    const removeBlock = (block: Point & { thunder?: boolean }) => {
      apply(blocks.filter((b) => b !== block));
      setBricks((bricks) => bricks + 1);
      if (block.thunder) setPower((power) => power + 1);
    };

    // `onBoard` is whether the release landed on the playable board (not a HUD
    // control, text, or the border ring / outside the SVG).
    const commit = (onBoard: boolean) => {
      if (timeRef.current <= 0) {
        dragRef.current = null;
        return;
      }
      if (svg) svg.style.transform = "";
      placingBlock.value = { ...placingBlock.value, placing: false };
      // The gesture is over: drop any lingering placement / thunder previews so
      // they don't stick around after release (touch has no follow-up move to
      // clear them).
      placingRef.current = false;
      thunderHover.value = undefined;

      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        transitionBlock.value = undefined;
        const { origin, dragged } = drag;

        // Never left its origin cell → a tap: upgrade to thunder with power,
        // otherwise delete.
        if (!dragged) {
          if (!onBoard) return;
          if (!origin.thunder && power) {
            apply(
              blocks.map((b) =>
                b === origin ? { ...origin, thunder: true } : b
              ),
            );
            setPower((power) => power - 1);
          } else {
            removeBlock(origin);
          }
          return;
        }

        // Dragged to a different cell on the board: drop it there if valid,
        // otherwise remove it (refunding its brick / power) — dragging a block
        // somewhere it can't go deletes it, same as a tap-delete. Back on its
        // origin, or released off-board, it snaps back untouched.
        const target = placingBlock.peek();
        if (target.x !== origin.x || target.y !== origin.y) {
          if (!onBoard) return;
          if (isInvalidMove(grid, checkpoint, origin, target.x, target.y)) {
            removeBlock(origin);
          } else {
            apply(
              blocks.map((b) =>
                b === origin ? { ...b, x: target.x, y: target.y } : b
              ),
            );
          }
        }
        return;
      }

      if (!onBoard) return;

      // Place a new block at the previewed cell.
      const { x, y } = placingBlock.peek();

      if (bricks <= 0) return;

      if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) return;

      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);

      try {
        if (!findPath(grid, checkpoint)) {
          offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
          return;
        }
      } catch { /* do nothing */ }

      const newBlocks = [...blocks, { x, y, local: true }];
      // Free play opens the run on this first placement: the block rides along
      // with startRun rather than a separate updateRun. Every later placement
      // (staged is now false) is a plain save.
      if (staged) {
        if (iteration !== undefined) {
          // Routed through the board loader so this run takes the board
          // token: an in-flight re-stage from just before the placement
          // can't clobber the freshly opened run. Its response re-seeds
          // the revert target via handleRun.
          startBoardRun(iteration, { x, y });
        }
        rebuildGrid(grid, checkpoint, newBlocks);
        setBlocks(newBlocks);
      } else {
        apply(newBlocks);
      }
      setBricks((bricks) => bricks - 1);
      if (staged) setStaged(false);

      placingBlock.value = { ...placingBlock.peek(), placing: false };
    };

    const mouseupCallback = (e: MouseEvent) => {
      if (isTouchSource(e)) return;
      commit(e.target instanceof SVGElement);
    };
    globalThis.addEventListener("mouseup", mouseupCallback);

    const touchendCallback = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const target = touch.target;
      touching.value = false;
      const onBoard = target instanceof SVGElement &&
        !(target instanceof SVGTextElement) &&
        !isBorderPoint(svg, touch.clientX, touch.clientY);
      commit(onBoard);
    };
    globalThis.addEventListener("touchend", touchendCallback);

    return () => {
      globalThis.removeEventListener("mouseup", mouseupCallback);
      globalThis.removeEventListener("touchend", touchendCallback);
    };
    // The clock and pointer state are read through refs/signals; the
    // listeners re-register only when the board itself changes. apply() reads
    // the render's blocks, so blocks stays a dependency.
  }, [
    svg,
    checkpoint,
    power,
    bricks,
    blocks,
    iteration,
    staged,
  ]);
};
