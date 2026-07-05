import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath, newGrid } from "../../../common/pathing.ts";
import { api } from "../../api.ts";
import { useIteration } from "../../hooks/useIteration.ts";
import { isBorderPoint, isTouchSource } from "./helpers.ts";
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
    transitionBlock,
    setBlocks,
    power,
    setPower,
    setBricks,
    placingBlockRef,
    bricks,
  } = useContext(GameStateContext);

  const iteration = useIteration();

  useEffect(() => {
    const callback = () => {
      if (time <= 0) return;
      if (svg) svg.style.transform = "";

      if (transitionBlock) {
        const { x, y } = transitionBlock;

        if (!transitionBlock.thunder && power) {
          // Upgrade to thunder
          setBlocks((blocks) => {
            const newBlocks = blocks.map((b) =>
              b === transitionBlock
                ? ({ ...transitionBlock, thunder: true })
                : b
            );
            api.updateRun({
              iteration: iteration ?? -1,
              blocks: newBlocks.filter((b) => b.local),
            });
            grid.splice(0, Infinity, ...newGrid());
            grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
            for (const { x, y } of newBlocks) {
              offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
            }
            return newBlocks;
          });
          setPower((power) => power - 1);
        } else {
          // Remove from blocks
          setBlocks((blocks) => {
            const newBlocks = blocks.filter((block) =>
              block !== transitionBlock
            );
            api.updateRun({
              iteration: iteration ?? -1,
              blocks: newBlocks.filter((b) => b.local),
            });

            grid.splice(0, Infinity, ...newGrid());
            grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
            for (const { x, y } of newBlocks) {
              offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
            }
            return newBlocks;
          });
          offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);

          setBricks((bricks) => bricks + 1);
          if (transitionBlock.thunder) setPower((power) => power + 1);
        }

        setTransitionBlock(undefined);
        // TODO: recall mousemove callback
        return;
      }

      const { x, y } = placingBlockRef.current;

      if (bricks <= 0) return;

      if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) return false;

      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);

      try {
        if (!findPath(grid, checkpoint)) {
          offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
          return false;
        }
      } catch { /* do nothing */ }

      setBlocks((blocks) => {
        const newBlocks = [...blocks, { x, y, local: true }];
        api.updateRun({
          iteration: iteration ?? -1,
          blocks: newBlocks.filter((b) => b.local),
        });
        grid.splice(0, Infinity, ...newGrid());
        grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
        for (const { x, y } of newBlocks) {
          offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
        }
        return newBlocks;
      });
      setBricks((bricks) => bricks - 1);

      setPlacingBlock({ ...placingBlockRef.current, placing: false });
    };

    const mousedownCallback = (e: MouseEvent) => {
      if (isTouchSource(e)) return;
      if (!(e.target instanceof SVGElement)) return;
      callback();
    };
    globalThis.addEventListener("mousedown", mousedownCallback);

    const touchendCallback = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const target = touch.target;
      setTouching(false);
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      if (
        !(target instanceof SVGElement) ||
        target instanceof SVGTextElement ||
        isBorderPoint(svg, touch.clientX, touch.clientY)
      ) {
        return;
      }
      callback();
    };
    globalThis.addEventListener("touchend", touchendCallback);

    return () => {
      globalThis.removeEventListener("mousedown", mousedownCallback);
      globalThis.removeEventListener("touchend", touchendCallback);
    };
  }, [svg, placingBlockRef.current, transitionBlock, invalid, checkpoint]);
};
