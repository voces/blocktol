import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath } from "../../../common/pathing.ts";
import { Point } from "../../../common/types.ts";
import { startBoardRun } from "../../store/board.ts";
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
    time,
    setPlacingBlock,
    checkpoint,
    grid,
    setTransitionBlock,
    setThunderHover,
    invalid,
    setTouching,
    setBlocks,
    power,
    setPower,
    setBricks,
    placingBlockRef,
    bricks,
    dragRef,
    placingRef,
    iteration,
    staged,
    setStaged,
  } = useContext(GameStateContext);

  useEffect(() => {
    // Persist the local maze via the run saver: serialized (one in-flight
    // save, newer edits coalesce), retried on network failure, and reconciled
    // by useInit's handlers — only a CONFIRMED save advances the revert
    // target; an expired or rejected save snaps the board back to it.
    const persist = (blocks: ReadonlyArray<Point & { local?: boolean }>) => {
      saveRun({
        iteration: iteration ?? -1,
        blocks: blocks.filter((b) => b.local),
      });
    };

    // Remove a local block, refunding its brick (and power, if it was a
    // thunder). Shared by a tap-delete and by dragging a block somewhere it
    // can't be placed.
    const removeBlock = (block: Point & { thunder?: boolean }) => {
      setBlocks((blocks) => {
        const newBlocks = blocks.filter((b) => b !== block);
        persist(newBlocks);
        rebuildGrid(grid, checkpoint, newBlocks);
        return newBlocks;
      });
      setBricks((bricks) => bricks + 1);
      if (block.thunder) setPower((power) => power + 1);
    };

    // `onBoard` is whether the release landed on the playable board (not a HUD
    // control, text, or the border ring / outside the SVG).
    const commit = (onBoard: boolean) => {
      if (time <= 0) {
        dragRef.current = null;
        return;
      }
      if (svg) svg.style.transform = "";
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      // The gesture is over: drop any lingering placement / thunder previews so
      // they don't stick around after release (touch has no follow-up move to
      // clear them).
      placingRef.current = false;
      setThunderHover(undefined);

      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        setTransitionBlock(undefined);
        const { origin, dragged } = drag;

        // Never left its origin cell → a tap: upgrade to thunder with power,
        // otherwise delete.
        if (!dragged) {
          if (!onBoard) return;
          if (!origin.thunder && power) {
            setBlocks((blocks) => {
              const newBlocks = blocks.map((b) =>
                b === origin ? { ...origin, thunder: true } : b
              );
              persist(newBlocks);
              rebuildGrid(grid, checkpoint, newBlocks);
              return newBlocks;
            });
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
        const target = placingBlockRef.current;
        if (target.x !== origin.x || target.y !== origin.y) {
          if (!onBoard) return;
          if (isInvalidMove(grid, checkpoint, origin, target.x, target.y)) {
            removeBlock(origin);
          } else {
            setBlocks((blocks) => {
              const newBlocks = blocks.map((b) =>
                b === origin ? { ...b, x: target.x, y: target.y } : b
              );
              persist(newBlocks);
              rebuildGrid(grid, checkpoint, newBlocks);
              return newBlocks;
            });
          }
        }
        return;
      }

      if (!onBoard) return;

      // Place a new block at the previewed cell.
      const { x, y } = placingBlockRef.current;

      if (bricks <= 0) return;

      if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) return;

      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);

      try {
        if (!findPath(grid, checkpoint)) {
          offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
          return;
        }
      } catch { /* do nothing */ }

      setBlocks((blocks) => {
        const newBlocks = [...blocks, { x, y, local: true }];
        // Free play opens the run on this first placement: the block rides along
        // with startRun rather than a separate updateRun. Every later placement
        // (staged is now false) is a plain updateRun.
        if (staged) {
          if (iteration !== undefined) {
            // Routed through the board loader so this run takes the board
            // token: an in-flight re-stage from just before the placement
            // can't clobber the freshly opened run. Its response re-seeds
            // the revert target via handleRun.
            startBoardRun(iteration, { x, y });
          }
        } else {
          persist(newBlocks);
        }
        rebuildGrid(grid, checkpoint, newBlocks);
        return newBlocks;
      });
      setBricks((bricks) => bricks - 1);
      if (staged) setStaged(false);

      setPlacingBlock({ ...placingBlockRef.current, placing: false });
    };

    const mouseupCallback = (e: MouseEvent) => {
      if (isTouchSource(e)) return;
      commit(e.target instanceof SVGElement);
    };
    globalThis.addEventListener("mouseup", mouseupCallback);

    const touchendCallback = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const target = touch.target;
      setTouching(false);
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
  }, [
    svg,
    placingBlockRef.current,
    invalid,
    checkpoint,
    time,
    power,
    bricks,
    iteration,
    staged,
  ]);
};
