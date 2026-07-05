import { useContext, useEffect } from "preact/compat";
import { GameStateContext } from "./useGameState.ts";

export const useClock = () => {
  const { setTime, staged } = useContext(GameStateContext);

  useEffect(() => {
    // Staged (free play, pre-placement) holds the build clock still — the run,
    // and its countdown, only begin on the first placement.
    if (staged) return;

    const interval = setInterval(
      () => setTime((time) => time > 0 ? time - 1 : time),
      1_000,
    );

    return () => clearInterval(interval);
  }, [staged]);
};
