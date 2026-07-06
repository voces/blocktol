import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath } from "../../../common/pathing.ts";
import { api } from "../../api.ts";
import { getTimeZone } from "../../util/timeZone.ts";
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
    invalid,
    setTouching,
    setBlocks,
    power,
    setPower,
    setBricks,
    placingBlockRef,
    bricks,
    dragRef,
    iteration,
    staged,
    setStaged,
    freePlay,
  } = useContext(GameStateContext);

  useEffect(() => {
    // `onBoard` is whether the release landed on the playable board (not a HUD
    // control, text, or the border ring / outside the SVG).
    const commit = (onBoard: boolean) => {
      if (time <= 0) {
        dragRef.current = null;
        return;
      }
      if (svg) svg.style.transform = "";
      setPlacingBlock((pb) => ({ ...pb, placing: false }));

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
              api.updateRun({
                iteration: iteration ?? -1,
                blocks: newBlocks.filter((b) => b.local),
                freePlay,
              });
              rebuildGrid(grid, checkpoint, newBlocks);
              return newBlocks;
            });
            setPower((power) => power - 1);
          } else {
            setBlocks((blocks) => {
              const newBlocks = blocks.filter((b) => b !== origin);
              api.updateRun({
                iteration: iteration ?? -1,
                blocks: newBlocks.filter((b) => b.local),
                freePlay,
              });
              rebuildGrid(grid, checkpoint, newBlocks);
              return newBlocks;
            });
            setBricks((bricks) => bricks + 1);
            if (origin.thunder) setPower((power) => power + 1);
          }
          return;
        }

        // Dragged → move to the release cell if it's different and valid;
        // otherwise (back on origin, invalid, or off-board) snap back.
        const target = placingBlockRef.current;
        if (
          onBoard &&
          (target.x !== origin.x || target.y !== origin.y) &&
          !isInvalidMove(grid, checkpoint, origin, target.x, target.y)
        ) {
          setBlocks((blocks) => {
            const newBlocks = blocks.map((b) =>
              b === origin ? { ...b, x: target.x, y: target.y } : b
            );
            api.updateRun({
              iteration: iteration ?? -1,
              blocks: newBlocks.filter((b) => b.local),
            });
            rebuildGrid(grid, checkpoint, newBlocks);
            return newBlocks;
          });
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
            api.startRun({
              iteration,
              timeZone: getTimeZone(),
              block: { x, y },
            });
          }
        } else {
          api.updateRun({
            iteration: iteration ?? -1,
            blocks: newBlocks.filter((b) => b.local),
            freePlay,
          });
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
    freePlay,
  ]);
};
