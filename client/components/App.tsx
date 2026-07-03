import { ComponentChildren, h } from "preact";
import { useEffect, useRef, useState } from "preact/compat";
import { api } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { Disconnected } from "./Disconnected.tsx";
import { Game } from "./Game/index.tsx";
import { GameStateContext, useGameState } from "./Game/useGameState.ts";
import { IntroBoard } from "./IntroBoard.tsx";
import { Profile } from "./Profile.tsx";

const Shell = (
  { children, gameState }: {
    children: ComponentChildren;
    gameState: ReturnType<typeof useGameState>;
  },
) => (
  <div style={{ textAlign: "center" }}>
    <h1>Blocktol</h1>
    <Profile />
    <GameStateContext.Provider value={gameState}>
      {children}
    </GameStateContext.Provider>
  </div>
);

const getHasCompletedOnboarding = () =>
  localStorage.getItem("hasCompletedOnboarding") === "true";
const setHasCompletedOnboarding = () =>
  localStorage.setItem("hasCompletedOnboarding", "true");

export const App = () => {
  const hadCompletedOnboarding = useRef(getHasCompletedOnboarding());
  const [showOnboarding, setShowOnboarding] = useState(
    !hadCompletedOnboarding.current,
  );
  const [retry, setRetry] = useState(0);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    if (showOnboarding) return;

    api.getDailySummary({ timeZone: getTimeZone() }).then((ret) => {
      setDisconnected(false);
      if ("error" in ret) {
        setDisconnected(true);
        setTimeout(() => setRetry((r) => r + 1), (retry + 1) ** 2 * 100);
        return;
      }
      if (ret.currentRun) return;
      if (ret.attempts.length < 3) {
        api.startRun({ iteration: "daily", timeZone: getTimeZone() });
      }
    }).catch(() => {
      setDisconnected(true);
      setTimeout(() => setRetry((r) => r + 1), (retry + 1) ** 2 * 100);
    });
  }, [showOnboarding, retry]);

  const gameState = useGameState();

  if (showOnboarding) {
    return (
      <Shell gameState={gameState}>
        <IntroBoard
          onDone={() => {
            setShowOnboarding(false);
            setHasCompletedOnboarding();
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell gameState={gameState}>
      <Game extraAttemptBannerTime={!hadCompletedOnboarding.current} />
      {disconnected && <Disconnected />}
    </Shell>
  );
};
