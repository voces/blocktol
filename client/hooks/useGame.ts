import { useCallback, useContext, useEffect } from "preact/compat";
import { createContext } from "preact";
import { emitter } from "../util/emitter.ts";

type GameEvents = {
  runStart: { duration: number };
  runFinish: { kind: "runFinish" };
};

const game = {};
const em = emitter<typeof game, GameEvents>(game);

const GameContext = createContext(em);

export const useGame = () => useContext(GameContext);

export const useGameListener = <L extends keyof GameEvents>(
  eventType: L,
  callback: (event: GameEvents[L]) => void,
  inputs: unknown[],
) => {
  const game = useGame();
  const cb = useCallback(callback, inputs);
  useEffect(() => {
    game.addEventListener(eventType, cb);
    return () => game.removeEventListener(eventType, cb);
  }, [game, eventType, cb, ...inputs]);
};
