import { useCallback, useContext } from "preact/compat";
import { Point } from "../../../common/types.ts";
import { GameStateContext } from "./useGameState.ts";

export const useOnSlow = () => {
  const { setBlocks } = useContext(GameStateContext);

  return useCallback((thunder: Point) => {
    // Animate thunder tower
    setBlocks(
      (thunders) =>
        thunders.map((t) =>
          t.x === thunder.x && t.y === thunder.y
            ? { ...thunder, active: true }
            : t
        ),
    );

    // Remove thunder tower animation after 0.1s
    setTimeout(() => {
      setBlocks(
        (thunders) =>
          thunders.map((t) =>
            t.x === thunder.x && t.y === thunder.y
              ? { ...thunder, active: false }
              : t
          ),
      );
    }, 100);
  }, []);
};
