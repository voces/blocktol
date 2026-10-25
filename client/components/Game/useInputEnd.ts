import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { type Point } from "../../../common/types.ts";
import { claimBoard } from "../../store/board.ts";
import {
  type BoardBlock,
  clearTouchZoom,
  placingBlock,
  thunderHover,
  transitionBlock,
} from "./interaction.ts";
import { DEBOUNCE_MS, saveRun } from "./runSaver.ts";
import { beginFreePlay, persistFreePlay } from "./freePlay.ts";
import {
  isBorderPoint,
  isInvalidMove,
  isTouchSource,
  localRun,
  rebuildGrid,
  solvable,
} from "./helpers.ts";
import { GameStateContext } from "./useGameState.ts";

// Trailing-debounce for a ranked save: DEBOUNCE_MS early in the build, ramping
// linearly to 0 over the final DEBOUNCE_RAMP_SECONDS so a late edit is
// confirmed before the window closes instead of reverted (the
// last-second-edit-lost incident). Free play doesn't use this saver.
const DEBOUNCE_RAMP_SECONDS = 10;
const saveDebounce = (secondsLeft: number) =>
  secondsLeft >= DEBOUNCE_RAMP_SECONDS ? DEBOUNCE_MS : Math.max(
    0,
    Math.round((DEBOUNCE_MS * secondsLeft) / DEBOUNCE_RAMP_SECONDS),
  );

export const useInputEnd = (svg: SVGSVGElement | null) => {
  const {
    timeRef,
    checkpoint,
    grid,
    blocksRef,
    setBlocks,
    setRun,
    budgetNow,
    dragRef,
    placingRef,
    iteration,
    staged,
    setStaged,
    setTime,
    freePlay,
    viewing,
    deadlineRef,
  } = useContext(GameStateContext);

  useEffect(() => {
    // Apply a new block list: recompute the runner path locally (no round
    // trip), then persist. Keep effects OUT of the setBlocks updater: updaters
    // must be pure, and a double-invoked one would double-fire the save.
    //
    // Every edit builds `newBlocks` from `blocksRef`, the board right now, NOT
    // the render that registered these listeners: Preact re-runs an effect
    // after paint, so a gesture within a frame of the previous one would edit
    // a stale snapshot and undo the previous edit. The brick counts derive from
    // the board (see useGameState), so writing it is the whole edit.
    const apply = (newBlocks: ReadonlyArray<BoardBlock>) => {
      rebuildGrid(grid, checkpoint, newBlocks);
      const localBlocks = newBlocks.filter((b) => b.local);
      const r = localRun(newBlocks, checkpoint);
      if (r) setRun(r);
      setBlocks(newBlocks);
      // Free play keeps its state in localStorage until commit; ranked saves to
      // the server, debounced by saveDebounce.
      if (freePlay) {
        persistFreePlay(
          iteration ?? -1,
          deadlineRef.current ?? Date.now(),
          localBlocks,
        );
      } else {
        saveRun(
          { iteration: iteration ?? -1, blocks: localBlocks },
          saveDebounce(timeRef.current),
        );
      }
    };

    // Remove a local block; the refund is just the block leaving the board, so
    // removing one already gone (a double tap racing the re-render) refunds
    // nothing. Used by tap-delete and by dragging a block somewhere invalid.
    const removeBlock = (block: Point & { thunder?: boolean }) => {
      apply(blocksRef.current.filter((b) => b !== block));
    };

    // `onBoard`: the release landed on the playable board (not a HUD control,
    // text, the border ring, or outside the SVG).
    const commit = (onBoard: boolean) => {
      // `viewing` is checked explicitly: a review can keep a live free-play
      // countdown (time > 0) but stays non-editable.
      if (viewing || timeRef.current <= 0) {
        dragRef.current = null;
        return;
      }
      if (svg) svg.style.transform = "";
      placingBlock.value = { ...placingBlock.value, placing: false };
      // Drop lingering previews; touch has no follow-up move to clear them.
      placingRef.current = false;
      thunderHover.value = undefined;

      // The board at release, not as the registering render saw it.
      const blocks = blocksRef.current;

      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        transitionBlock.value = undefined;
        const { origin, dragged } = drag;

        // Never left its origin cell: a tap upgrades to thunder with power in
        // hand, otherwise deletes.
        if (!dragged) {
          if (!onBoard) return;
          if (!origin.thunder && budgetNow().power > 0) {
            apply(
              blocks.map((b) =>
                b === origin ? { ...origin, thunder: true } : b
              ),
            );
          } else {
            removeBlock(origin);
          }
          return;
        }

        // Dragged to another cell: drop it there if valid, else delete it. Back
        // on its origin, or released off-board, it snaps back untouched.
        const target = placingBlock.peek();
        if (target.x !== origin.x || target.y !== origin.y) {
          if (!onBoard) return;
          if (
            isInvalidMove(grid, blocks, checkpoint, origin, target.x, target.y)
          ) {
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

      if (budgetNow().bricks <= 0) return;

      if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) return;

      // A placement that walls the runner off entirely is refused.
      if (!solvable(blocks, checkpoint, { x, y })) return;

      const newBlocks = [...blocks, { x, y, local: true }];
      // Free play opens the run on its first placement, locally: the client
      // owns the 60s deadline and mints the attempt's idempotency id. Claim the
      // board token so an in-flight re-stage can't land and clobber the fresh
      // build.
      //
      // The deadline, not `staged` alone, says the run is open: this closure
      // can still report `staged` a frame after the opening placement, and
      // re-opening would mint a second id and re-arm the window.
      if (staged && deadlineRef.current === null) {
        claimBoard();
        beginFreePlay();
        deadlineRef.current = Date.now() + 60_000;
        setTime(60);
        setStaged(false);
      }
      apply(newBlocks);

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
      // Cancel any pending zoom arm: a tap released before the delay must not
      // zoom after the finger is gone.
      clearTouchZoom();
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
    // The clock, board and budgets are read through refs/signals, so listeners
    // re-register only when what a gesture MEANS changes, never per edit.
  }, [svg, checkpoint, iteration, staged, freePlay, viewing]);
};
