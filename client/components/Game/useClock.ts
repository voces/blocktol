import { useContext, useEffect } from "preact/hooks";
import { GameStateContext } from "./useGameState.ts";

export const useClock = () => {
  const { setTime } = useContext(GameStateContext);

  useEffect(() => {
    const interval = setInterval(
      () => setTime((time) => time > 0 ? time - 1 : time),
      1_000,
    );

    return () => clearInterval(interval);
  }, []);
};
