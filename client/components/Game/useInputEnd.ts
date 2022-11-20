import { useContext, useEffect } from "preact/hooks";
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
        connection.send({
          kind: "transition",
          x: transitionBlock.x,
          y: transitionBlock.y,
        });

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
          offsets.forEach(([xd, yd]) =>
            grid[transitionBlock.y + yd][transitionBlock.x + xd] = false
          );
        }

        setTransitionBlock(undefined);
        // TODO: recall mousemove callback
        return;
      }

      if (bricks <= 0) return;

      if (
        offsets.some(([xd, yd]) =>
          grid[placingBlockRef.current.y + yd][placingBlockRef.current.x + xd]
        )
      ) return false;

      try {
        if (!findPath(grid, checkpoint)) return false;
      } catch { /* do nothing */ }

      offsets.forEach(([xd, yd]) =>
        grid[placingBlockRef.current.y + yd][placingBlockRef.current.x + xd] =
          true
      );

      connection.send({
        kind: "block",
        x: placingBlockRef.current.x,
        y: placingBlockRef.current.y,
      });
      setBlocks((
        blocks,
      ) => [...blocks, {
        x: placingBlockRef.current.x,
        y: placingBlockRef.current.y,
        local: true,
      }]);
      setBricks((bricks) => bricks - 1);

      setPlacingBlock({ ...placingBlockRef.current, placing: false });
    };

    const mousedownCallback = (e: MouseEvent) => {
      if (isTouchSource(e)) return;
      callback();
    };
    globalThis.addEventListener("mousedown", mousedownCallback);

    const touchendCallback = () => {
      setTouching(false);
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      callback();
    };
    globalThis.addEventListener("touchend", touchendCallback);

    return () => {
      globalThis.removeEventListener("mousedown", mousedownCallback);
      globalThis.removeEventListener("touchend", touchendCallback);
    };
  }, [svg, placingBlockRef.current, transitionBlock, invalid]);
};
