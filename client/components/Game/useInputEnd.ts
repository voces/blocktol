import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { Point } from "../../../common/types.ts";
import { claimBoard } from "../../store/board.ts";
import {
  BoardBlock,
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

// Trailing-debounce window for a ranked save, shrinking as the clock runs out.
// Early in the build a burst of placements collapses to one save (DEBOUNCE_MS);
// over the final RAMP_SECONDS it ramps linearly to 0, so a late edit is sent
// almost immediately and is server-confirmed before the window closes rather
// than caught by it and reverted (the last-second-edit-lost incident). At ~5s
// left the wait is ~1s, at 1s it's ~0.2s, at 0 it sends now. Free play doesn't
// use this saver (it persists locally and commits once at execution).
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
    // Apply a new block list: update the board from the shared engine locally (so
    // the runner path moves the instant a block lands — no round trip), then
    // persist. Effectful work stays OUT of the setBlocks updater — updaters are
    // contractually pure, and a double-invoked updater would double-fire the
    // save.
    //
    // Every edit below builds `newBlocks` from `blocksRef`, the board as it
    // stands right now — NOT from the render that registered these listeners.
    // Preact re-runs an effect after paint, so a gesture landing within a frame
    // of the previous one still runs on the old closure; editing that snapshot
    // wrote a board with the previous edit undone (a deleted block back on the
    // board), and the brick counts drifted with it. The counts now derive from
    // the board (see useGameState), so writing it is the whole edit.
    const apply = (newBlocks: ReadonlyArray<BoardBlock>) => {
      rebuildGrid(grid, checkpoint, newBlocks);
      const localBlocks = newBlocks.filter((b) => b.local);
      const r = localRun(newBlocks, checkpoint);
      if (r) setRun(r);
      setBlocks(newBlocks);
      // Persistence diverges by mode. Free play keeps its state on the client
      // (localStorage) until commit — no network mid-build. Ranked saves to the
      // server, debounced by a delay that shrinks to 0 as the clock runs out
      // (saveDebounce) so a last-second edit still lands.
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

    // Remove a local block, refunding its brick (and power, if it was a
    // thunder) — the refund is just the block leaving the board, so removing one
    // that is already gone (a double tap racing the re-render) refunds nothing.
    // Shared by a tap-delete and by dragging a block somewhere it can't be
    // placed.
    const removeBlock = (block: Point & { thunder?: boolean }) => {
      apply(blocksRef.current.filter((b) => b !== block));
    };

    // `onBoard` is whether the release landed on the playable board (not a HUD
    // control, text, or the border ring / outside the SVG).
    const commit = (onBoard: boolean) => {
      // `viewing` checked explicitly: a reviewed maze keeps a live free-play
      // build's countdown on the clock (time > 0), but stays non-editable.
      if (viewing || timeRef.current <= 0) {
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

      // The board as it stands at release, not as the registering render saw it.
      const blocks = blocksRef.current;

      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        transitionBlock.value = undefined;
        const { origin, dragged } = drag;

        // Never left its origin cell → a tap: upgrade to thunder with power,
        // otherwise delete.
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

        // Dragged to a different cell on the board: drop it there if valid,
        // otherwise remove it (refunding its brick / power) — dragging a block
        // somewhere it can't go deletes it, same as a tap-delete. Back on its
        // origin, or released off-board, it snaps back untouched.
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

      // A placement that walls the runner off entirely is refused outright
      // (the grid stays untouched — apply() rebuilds it from blocks anyway).
      if (!solvable(blocks, checkpoint, { x, y })) return;

      const newBlocks = [...blocks, { x, y, local: true }];
      // Free play opens the run on this first placement — locally, with no
      // startRun. The client owns the 60s window (deadline) and mints the
      // attempt's idempotency id; the server hears nothing until commit. Claim
      // the board token so an in-flight re-stage fired just before this placement
      // can't land and clobber the fresh build. `apply` then computes the path
      // and persists locally, exactly like every later placement.
      //
      // The deadline is what says the run is already open, not `staged` alone
      // (which this render's closure can still report true a frame after the
      // opening placement — see apply): re-opening would mint a second
      // idempotency id and re-arm the window from now.
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
      // Turn the zoom off and cancel any still-pending arm (a tap released
      // before the delay elapsed must not zoom after the finger is gone).
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
    // The clock, the board and the budgets are read through refs/signals, so the
    // listeners re-register only on the handful of things that change what a
    // gesture MEANS — never per edit, which is exactly the window a fast second
    // gesture used to fall into.
  }, [svg, checkpoint, iteration, staged, freePlay, viewing]);
};
