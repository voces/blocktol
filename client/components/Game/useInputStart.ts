import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath } from "../../../common/pathing.ts";
import { isBorderPoint, isTouchSource } from "./helpers.ts";
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
  } = useContext(GameStateContext);

  useEffect(() => {
    const callback = (clientX: number, clientY: number) => {
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
        Math.abs(nearest.x - x) <= 1 && Math.abs(nearest.y - y) <= 1
          ? nearest
          : undefined;
      // console.log(nearest);
      // const overlap = blocks.find((b) => b.x === x && b.y === y) ??
      //   blocks.find((b) => Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1);

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
      callback(touch.clientX, touch.clientY);
      e.preventDefault();
    };
    globalThis.addEventListener("touchstart", touchstartCallback);

    return () => {
      globalThis.removeEventListener("mousemove", mousemoveCallback);
      globalThis.removeEventListener("touchstart", touchstartCallback);
      globalThis.removeEventListener("touchmove", touchmoveCallback);
    };
  }, [svg, bricks, blocks, checkpoint, time]);
};
