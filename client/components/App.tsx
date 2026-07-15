import { ComponentChildren, h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/compat";
import { avatarColor } from "../../common/avatar.ts";
import { api } from "../api.ts";
import { primeSession } from "../boot.ts";
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
import { NotificationsBell } from "./Notifications/Bell.tsx";
import { Profile } from "./Profile.tsx";
import { Toast } from "./Toast.tsx";
import {
  fetchNotifications,
  initPushChannel,
  startNotificationsPolling,
} from "../store/notifications.ts";
import { consumeDeepLink } from "../store/notifNav.ts";
import { startRolloverWatch } from "../store/dailyRollover.ts";
import { syncPushSubscription } from "../util/push.ts";
import { getCleanLink, getId, getPendingLink } from "../util/id.ts";
import { usePullToRefresh } from "../hooks/usePullToRefresh.ts";

const Shell = (
  { children, gameState }: {
    children: ComponentChildren;
    gameState: ReturnType<typeof useGameState>;
  },
) => {
  // Pull-to-refresh, anchored to the header (the board owns touch below it) —
  // the app disables the browser's native pull-to-refresh, so this stands in
  // for it in a tab as well as the installed PWA. Its state lives here, not App,
  // so a pull only re-renders the Shell — `children` (the board) is an unchanged
  // vnode and Preact skips it.
  const { pull, refreshing, dragging, threshold, handlers } =
    usePullToRefresh();
  // Opacity ramps to full by the threshold (armed cue); the spin tracks the
  // UNCAPPED pull so it keeps turning through the rubber-band past the
  // threshold instead of freezing partway down.
  const progress = Math.min(pull / threshold, 1);
  const spin = (pull / threshold) * 300;
  // A touch of the player's own colour on the spinner (their avatar hue).
  const youColor = useMemo(() => avatarColor(getId()), []);
  return (
    // The provider wraps the header too, so its calendar button can share game
    // state with the (mobile) calendar modal rendered down in the game tree.
    // (Server entities — daily list, profile — live in module stores now, no
    // provider needed.)
    <GameStateContext.Provider value={gameState}>
      <div style={{ textAlign: "center" }}>
        {
          /* Always mounted (invisible at rest) so the release can EASE back —
            unmounting would cut the transition. */
        }
        <div
          class={"pull-refresh" +
            (dragging ? " pull-refresh--dragging" : "") +
            (refreshing ? " pull-refresh--active" : "")}
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
              ? { color: youColor }
              : { color: youColor, transform: `rotate(${spin}deg)` }}
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
        <header class="app-header" {...handlers}>
          <div class="app-header__brand">
            <Logo size={24} />
            <h1>Blocktol</h1>
          </div>
          <div class="app-header__actions">
            <CalendarButton />
            <NotificationsBell />
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
  // Bumped when the app returns to the foreground still stuck on an unstaged
  // board (see the resume-recovery effect below); re-runs the boot staging.
  const [resumeNonce, setResumeNonce] = useState(0);

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
      // Staging is the summary listener's job now (useInit): it resumes an
      // in-progress run (currentRun) or raises the explicit "Start attempt"
      // overlay when attempts remain. Nothing auto-starts here — an attempt
      // opens only when the player taps Start, so a background boot can't
      // silently spend one.
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
  }, [showOnboarding, linkPending, retry, resumeNonce]);

  // Notifications: warm the bell, start the quiet badge poll, and (for users who
  // already granted permission) re-register their push subscription. One-shot,
  // once the app is past onboarding / a pending sign-in link.
  const notificationsBooted = useRef(false);
  useEffect(() => {
    if (showOnboarding || linkPending || notificationsBooted.current) return;
    notificationsBooted.current = true;
    fetchNotifications();
    startNotificationsPolling();
    initPushChannel();
    syncPushSubscription();
    // Watch for local midnight ticking over so a new daily surfaces without a
    // manual refresh (store/dailyRollover.ts).
    startRolloverWatch();
    // If this load came from a day permalink / push notification, route to the
    // day it points at (runs after the game tree mounts, so board handlers exist).
    consumeDeepLink();
  }, [showOnboarding, linkPending]);

  const gameState = useGameState();

  // Recover a board that never finished staging when the app is reopened. A
  // backgrounded PWA gets suspended/frozen (iOS) or frozen then possibly
  // discarded (Android's Page Lifecycle) — the boot summary request in flight
  // when it froze can stall and never settle, leaving the board stuck on the
  // loading phase (never reaching the "Start attempt" overlay or a resumed run).
  // Reopening fires visibilitychange/pageshow but no fresh navigation, so
  // nothing re-boots — the "had to manually refresh" report (seen on both iOS
  // and Android). On return to the foreground still in `loading`, re-run the
  // boot staging (the automatic form of that refresh). Going back through
  // getDailySummary is the SAFE recovery: it resumes an already-open run and
  // never starts one, so it can't spend a ranked attempt. Gated on the loading
  // phase so a live build/run — or the Start overlay (prestart) — coming back to
  // the foreground is left untouched. pageshow is gated on `persisted` (a
  // bfcache restore) so a normal first load — which fires pageshow while already
  // loading — doesn't double-boot; visibilitychange never fires on first load.
  useEffect(() => {
    if (showOnboarding || linkPending) return;
    const recover = () => {
      if (
        document.visibilityState === "visible" &&
        gameState.phase === "loading"
      ) {
        setResumeNonce((n) => n + 1);
      }
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) recover();
    };
    document.addEventListener("visibilitychange", recover);
    globalThis.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", recover);
      globalThis.removeEventListener("pageshow", onPageShow);
    };
  }, [showOnboarding, linkPending, gameState.phase]);

  if (linkPending) {
    return <MoveGate onResolved={() => setLinkPending(false)} />;
  }

  if (showOnboarding) {
    return (
      <Shell gameState={gameState}>
        <IntroBoard
          onDone={() => {
            // Fire the one boot request NOW, before the re-render mounts Game and
            // its effects fetch — so a first-time user's first load consolidates
            // to a single request instead of fanning out (the module-eval prime
            // was skipped so boot's daily auto-start didn't open the 60s clock
            // mid-tutorial; finishing onboarding is when it should). Set
            // synchronously here, the primes are in place before the effects run.
            primeSession();
            setShowOnboarding(false);
            setHasCompletedOnboarding();
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell gameState={gameState}>
      <Game />
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
