import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath } from "../../../common/pathing.ts";
import { isTouchSource } from "./helpers.ts";
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

      const overlap = blocks.find((b) =>
        Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1
      );

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
      if (!(e.changedTouches[0].target instanceof SVGElement)) return;
      e.preventDefault();
      callback(e.touches[0].clientX, e.touches[0].clientY);
    };
    globalThis.addEventListener("touchmove", touchmoveCallback, {
      passive: false,
    });

    const touchstartCallback = (e: TouchEvent) => {
      if (!(e.changedTouches[0].target instanceof SVGElement)) return;
      setTouching(true);
      callback(e.touches[0].clientX, e.touches[0].clientY);
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
