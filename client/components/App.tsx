import { ComponentChildren, h } from "preact";
import { useEffect, useRef, useState } from "preact/compat";
import { api } from "../api.ts";
import { startBoardRun } from "../store/board.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { Disconnected } from "./Disconnected.tsx";
import { Game } from "./Game/index.tsx";
import { GameStateContext, useGameState } from "./Game/useGameState.ts";
import { failures } from "../store/connection.ts";
import { fetchProfile } from "../store/profile.ts";
import { adoptServerSettings } from "../hooks/useSettings.ts";
import { CalendarButton } from "./CalendarButton.tsx";
import { IntroBoard } from "./IntroBoard.tsx";
import { Logo } from "./Logo.tsx";
import { MoveGate } from "./MoveGate.tsx";
import { Profile } from "./Profile.tsx";
import { Toast } from "./Toast.tsx";
import { getCleanLink, getPendingLink } from "../util/id.ts";
import { usePullToRefresh } from "../hooks/usePullToRefresh.ts";

const Shell = (
  { children, gameState }: {
    children: ComponentChildren;
    gameState: ReturnType<typeof useGameState>;
  },
) => {
  // Installed-PWA pull-to-refresh, anchored to the header (the board owns touch
  // below it). Inert in a browser tab, which keeps its own reload. Its state
  // lives here, not App, so a pull only re-renders the Shell — `children` (the
  // board) is an unchanged vnode and Preact skips it.
  const { pull, refreshing, threshold, handlers } = usePullToRefresh();
  // Opacity ramps to full by the threshold (armed cue); the spin tracks the
  // UNCAPPED pull so it keeps turning through the rubber-band past the
  // threshold instead of freezing partway down.
  const progress = Math.min(pull / threshold, 1);
  const spin = (pull / threshold) * 300;
  return (
    // The provider wraps the header too, so its calendar button can share game
    // state with the (mobile) calendar modal rendered down in the game tree.
    // (Server entities — daily list, profile — live in module stores now, no
    // provider needed.)
    <GameStateContext.Provider value={gameState}>
      <div style={{ textAlign: "center" }}>
        {(pull > 0 || refreshing) && (
          <div
            class={"pull-refresh" + (refreshing ? " pull-refresh--active" : "")}
            style={{
              transform: `translateY(${refreshing ? threshold : pull}px)`,
              opacity: refreshing ? 1 : progress,
            }}
            aria-hidden="true"
          >
            <svg
              class="pull-refresh__spinner"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              style={refreshing
                ? undefined
                : { transform: `rotate(${spin}deg)` }}
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                stroke-width="2.6"
                stroke-linecap="round"
                stroke-dasharray="42 14"
              />
            </svg>
          </div>
        )}
        <header class="app-header" {...handlers}>
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
  );
};

export const getHasCompletedOnboarding = () =>
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
  // A one-shot toast left by the move/merge gate (silent adopt) — read once on
  // boot and auto-dismissed. See MoveGate.reloadAs.
  const [toast, setToast] = useState<{ title: string; sub?: string } | null>(
    () => {
      try {
        const raw = sessionStorage.getItem("gateToast");
        if (!raw) return null;
        sessionStorage.removeItem("gateToast");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
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
      if (ret.currentRun) return;
      // The summary auto-starts the daily server-side and returns it as
      // currentRun; this explicit start is only the fallback for when that
      // insert failed.
      if (ret.ranked.length < 3) startBoardRun("daily");
    }).catch(() => {
      setDisconnected(true);
      setTimeout(() => setRetry((r) => r + 1), (retry + 1) ** 2 * 100);
    });
    // Warm the profile cache in parallel — the route seeds the user row
    // itself, so this no longer waits on the summary's first-load seeding.
    // Its payload carries the server-persisted settings; adopt them (the
    // cross-device source of truth) over the boot-time localStorage guess.
    fetchProfile().then((p) => {
      if (p?.settings) adoptServerSettings(p.settings);
    });
  }, [showOnboarding, linkPending, retry]);

  const gameState = useGameState();

  if (linkPending) {
    return <MoveGate onResolved={() => setLinkPending(false)} />;
  }

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
      {
        /* Boot failure, or persistent mid-game transport failures (the run
        saver keeps retrying underneath — this just tells the player why the
        board stopped responding). */
      }
      {(disconnected || failures.value >= 2) && <Disconnected />}
      {toast && (
        <Toast
          title={toast.title}
          sub={toast.sub}
          onClose={() => setToast(null)}
        />
      )}
    </Shell>
  );
};
