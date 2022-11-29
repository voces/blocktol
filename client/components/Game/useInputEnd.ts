import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { findPath } from "../../../common/pathing.ts";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { isTouchSource } from "./helpers.ts";
import { GameStateContext } from "./useGameState.ts";

export const useInputEnd = (svg: SVGSVGElement | null) => {
  const connection = useContext(ConnectionContext);
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
    setThunders,
    power,
    setPower,
    setBricks,
    placingBlockRef,
    bricks,
  } = useContext(GameStateContext);

  useEffect(() => {
    const callback = () => {
      if (invalid || time <= 0) return;
      if (svg) svg.style.transform = "";

      if (transitionBlock) {
        const { x, y } = transitionBlock;
        connection.send({ kind: "transition", x, y });

        // Remove from blocks
        setBlocks((blocks) =>
          blocks.filter((block) => block !== transitionBlock)
        );

        // Remove from thunders
        let isThunder = false;
        setThunders((thunders) =>
          thunders.filter((thunder) => {
            if (thunder === transitionBlock) {
              isThunder = true;
              return false;
            }
            return true;
          })
        );

        // Upgrade to thunder
        if (power && !isThunder) {
          setThunders((thunders) => [...thunders, transitionBlock]);
          setPower((power) => power - 1);

          // Remove
        } else {
          setBricks((bricks) => bricks + 1);
          if (isThunder) setPower((power) => power + 1);
          offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
        }

        setTransitionBlock(undefined);
        // TODO: recall mousemove callback
        return;
      }

      const { x, y } = placingBlockRef.current;

      if (bricks <= 0) return;

      if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) return false;

      try {
        if (!findPath(grid, checkpoint)) return false;
      } catch { /* do nothing */ }

      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);

      connection.send({ kind: "block", x, y });
      setBlocks((blocks) => [...blocks, { x, y, local: true }]);
      setBricks((bricks) => bricks - 1);

      setPlacingBlock({ ...placingBlockRef.current, placing: false });
    };

    const mousedownCallback = (e: MouseEvent) => {
      if (isTouchSource(e)) return;
      callback();
    };
    globalThis.addEventListener("mousedown", mousedownCallback);

    const touchendCallback = (e: TouchEvent) => {
      setTouching(false);
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      if (!(e.changedTouches[0].target instanceof SVGElement)) return;
      callback();
    };
    globalThis.addEventListener("touchend", touchendCallback);

    return () => {
      globalThis.removeEventListener("mousedown", mousedownCallback);
      globalThis.removeEventListener("touchend", touchendCallback);
    };
  }, [svg, placingBlockRef.current, transitionBlock, invalid]);
};
