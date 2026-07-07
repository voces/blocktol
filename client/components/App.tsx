import { ComponentChildren, h } from "preact";
import { useEffect, useRef, useState } from "preact/compat";
import { api } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { Disconnected } from "./Disconnected.tsx";
import { Game } from "./Game/index.tsx";
import { GameStateContext, useGameState } from "./Game/useGameState.ts";
import {
  DailyItemsContext,
  DailyItemsStore,
  useDailyItemsStore,
} from "../hooks/useDailyItems.tsx";
import { fetchProfile } from "../hooks/useProfile.ts";
import { adoptServerSettings } from "../hooks/useSettings.ts";
import { CalendarButton } from "./CalendarButton.tsx";
import { IntroBoard } from "./IntroBoard.tsx";
import { Logo } from "./Logo.tsx";
import { MoveGate } from "./MoveGate.tsx";
import { Profile } from "./Profile.tsx";
import { getCleanLink, getPendingLink } from "../util/id.ts";

const Shell = (
  { children, gameState, dailyStore }: {
    children: ComponentChildren;
    gameState: ReturnType<typeof useGameState>;
    dailyStore: DailyItemsStore;
  },
) => (
  // The providers wrap the header too, so its calendar button can share game
  // state with the (mobile) calendar modal rendered down in the game tree.
  <DailyItemsContext.Provider value={dailyStore}>
    <GameStateContext.Provider value={gameState}>
      <div style={{ textAlign: "center" }}>
        <header class="app-header">
          <div class="app-header__brand">
            <Logo size={24} />
            <h1>Blocktol</h1>
          </div>
          <div class="app-header__actions">
            <CalendarButton />
            <Profile />
          </div>
        </header>
        {children}
      </div>
    </GameStateContext.Provider>
  </DailyItemsContext.Provider>
);

const getHasCompletedOnboarding = () =>
  localStorage.getItem("hasCompletedOnboarding") === "true";
const setHasCompletedOnboarding = () =>
  localStorage.setItem("hasCompletedOnboarding", "true");

export const App = () => {
  // A sign-in link that opened on this device is resolved before anything else —
  // ahead of onboarding and the game. On a clean device or with no pending link
  // this is already settled, so the gate never shows.
  const [linkPending, setLinkPending] = useState(
    () => !!(getPendingLink() || getCleanLink()),
  );

  const hadCompletedOnboarding = useRef(getHasCompletedOnboarding());
  const [showOnboarding, setShowOnboarding] = useState(
    !hadCompletedOnboarding.current,
  );
  const [retry, setRetry] = useState(0);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    if (showOnboarding || linkPending) return;

    // The calendar loads its own months on mount (and the today-result panel
    // shares that data), so no list() call is needed here.
    api.getDailySummary({ timeZone: getTimeZone() }).then((ret) => {
      setDisconnected(false);
      if ("error" in ret) {
        setDisconnected(true);
        setTimeout(() => setRetry((r) => r + 1), (retry + 1) ** 2 * 100);
        return;
      }
      // Warm the profile cache once the summary lands — by then any first-load
      // name seeding has committed — so opening the profile is instant. Its
      // payload carries the server-persisted settings; adopt them (the
      // cross-device source of truth) over the boot-time localStorage guess.
      fetchProfile().then((p) => {
        if (p?.settings) adoptServerSettings(p.settings);
      });
      if (ret.currentRun) return;
      if (ret.ranked.length < 3) {
        api.startRun({ iteration: "daily", timeZone: getTimeZone() });
      }
    }).catch(() => {
      setDisconnected(true);
      setTimeout(() => setRetry((r) => r + 1), (retry + 1) ** 2 * 100);
    });
  }, [showOnboarding, linkPending, retry]);

  const gameState = useGameState();
  const dailyStore = useDailyItemsStore();

  if (linkPending) {
    return <MoveGate onResolved={() => setLinkPending(false)} />;
  }

  if (showOnboarding) {
    return (
      <Shell gameState={gameState} dailyStore={dailyStore}>
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
    <Shell gameState={gameState} dailyStore={dailyStore}>
      <Game extraAttemptBannerTime={!hadCompletedOnboarding.current} />
      {disconnected && <Disconnected />}
    </Shell>
  );
};
