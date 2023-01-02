import { ComponentChildren, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { ConnectionContext } from "../contexts/Connection.ts";
import { useConnectionState } from "../hooks/useConnectionState.ts";
import { getId } from "../util/id.ts";
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
  const id = getId();
  const connection = useContext(ConnectionContext);
  const connected = useConnectionState();
  const hadCompletedOnboarding = useRef(getHasCompletedOnboarding());
  const [showOnboarding, setShowOnboarding] = useState(
    !hadCompletedOnboarding.current,
  );

  useEffect(() => {
    if (!connected || showOnboarding) return;

    connection.send({
      kind: "login",
      username: undefined,
      id,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, [connected, showOnboarding]);

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
    </Shell>
  );
};
