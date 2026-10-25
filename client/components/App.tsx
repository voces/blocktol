import { type ComponentChildren, h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/compat";
import { avatarColor } from "../../common/avatar.ts";
import { api } from "../api.ts";
import { primeSession } from "../boot.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { storage, storagePersistent } from "../util/storage.ts";
import { StorageNotice } from "./StorageNotice.tsx";
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
import { useVersionRefresh } from "../hooks/useVersionRefresh.ts";
import { CrashScreen } from "./ErrorBoundary.tsx";

// Boot summary retries: quadratic backoff capped at this, and how many error
// ANSWERS (not dropped connections) to retry before showing the error screen.
const BOOT_RETRY_MAX_MS = 30_000;
const BOOT_ERROR_RETRIES = 3;

const Shell = (
  { children, gameState }: {
    children: ComponentChildren;
    gameState: ReturnType<typeof useGameState>;
  },
) => {
  // Pull-to-refresh, anchored to the header (the board owns touch below it);
  // stands in for the native one the app disables. The state lives here, not in
  // App, so a pull re-renders only Shell: `children` is an unchanged vnode.
  const { pull, refreshing, dragging, threshold, handlers } =
    usePullToRefresh();
  // Opacity ramps to full by the threshold (armed cue); the spin tracks the
  // UNCAPPED pull so it keeps turning past the threshold.
  const progress = Math.min(pull / threshold, 1);
  const spin = (pull / threshold) * 300;
  // The spinner wears the player's avatar hue.
  const youColor = useMemo(() => avatarColor(getId()), []);
  return (
    // The provider wraps the header so its calendar button shares game state
    // with the mobile calendar modal in the game tree.
    <GameStateContext.Provider value={gameState}>
      <div style={{ textAlign: "center" }}>
        {
          /* Always mounted (invisible at rest) so release can ease back. */
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
  storage.getItem("hasCompletedOnboarding") === "true";
const setHasCompletedOnboarding = () =>
  storage.setItem("hasCompletedOnboarding", "true");

export const App = () => {
  // A sign-in link opened on this device is resolved before onboarding and the
  // game. With no pending link the gate never shows.
  const [linkPending, setLinkPending] = useState(
    () => !!(getPendingLink() || getCleanLink()),
  );

  const hadCompletedOnboarding = useRef(getHasCompletedOnboarding());
  const [showOnboarding, setShowOnboarding] = useState(
    !hadCompletedOnboarding.current,
  );
  const [introRun, setIntroRun] = useState(0);
  // One-shot toast left by the move/merge gate's silent adopt; read once at
  // boot, auto-dismissed. See MoveGate.reloadAs.
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
  // Boot summaries answered with an error so far; past BOOT_ERROR_RETRIES the
  // error screen replaces retrying.
  const bootErrors = useRef(0);
  const [bootFailed, setBootFailed] = useState(false);
  // Bumped to re-run boot staging when the app returns to the foreground still
  // unstaged (see the recovery effect below).
  const [resumeNonce, setResumeNonce] = useState(0);

  useEffect(() => {
    if (showOnboarding || linkPending) return;

    // The calendar loads its own months, so no list() call is needed here.
    // Retry with a capped backoff.
    const again = () =>
      setTimeout(
        () => setRetry((r) => r + 1),
        Math.min((retry + 1) ** 2 * 100, BOOT_RETRY_MAX_MS),
      );
    api.getDailySummary({ timeZone: getTimeZone() }).then((ret) => {
      setDisconnected(false);
      if ("error" in ret) {
        // The server ANSWERED with an error. A few retries ride out a transient
        // fault (a DB hiccup's 500); past that, retrying forever would only
        // hammer the server behind a false "Connecting…" overlay.
        bootErrors.current++;
        if (bootErrors.current > BOOT_ERROR_RETRIES) return setBootFailed(true);
        setDisconnected(true);
        again();
        return;
      }
      bootErrors.current = 0;
      // Staging is the summary listener's job (useInit): it resumes a
      // `currentRun` or raises the "Start attempt" overlay. Nothing auto-starts
      // here, so a background boot can't spend an attempt.
    }).catch(() => {
      // No answer at all: disconnected; keep trying.
      setDisconnected(true);
      again();
    });
    // Warm the profile cache in parallel; `getProfile` seeds the user row, so
    // it needn't wait on the summary. Its server-persisted settings (the
    // cross-device source of truth) override the boot-time localStorage guess.
    fetchProfile().then((p) => {
      if (p?.settings) adoptServerSettings(p.settings);
    });
  }, [showOnboarding, linkPending, retry, resumeNonce]);

  // One-shot, once past onboarding and any sign-in link: warm the bell, start
  // the badge poll, and re-register the push subscription if permission is
  // already granted.
  const notificationsBooted = useRef(false);
  useEffect(() => {
    if (showOnboarding || linkPending || notificationsBooted.current) return;
    notificationsBooted.current = true;
    fetchNotifications();
    startNotificationsPolling();
    initPushChannel();
    syncPushSubscription();
    // Surface a new daily at local midnight (store/dailyRollover.ts).
    startRolloverWatch();
    // Route a day permalink / push notification load to its day; runs after the
    // game tree mounts so board handlers exist.
    consumeDeepLink();
  }, [showOnboarding, linkPending]);

  const gameState = useGameState();

  // Recover a board stuck in `loading`. A backgrounded PWA is frozen (iOS) or
  // discarded (Android), so the in-flight boot summary can stall forever, and
  // reopening fires visibilitychange/pageshow but no re-boot. On foreground
  // return still in `loading`, re-run boot staging. getDailySummary is the SAFE
  // route: it resumes an open run and never starts one, so it can't spend a
  // ranked attempt. Gated on `loading` so a live build/run or the Start overlay
  // is left alone. pageshow is gated on `persisted` (bfcache restore) so a
  // normal first load doesn't double-boot; visibilitychange never fires then.
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

  // Reload to the newest build once the server reports one, deferred until the
  // board is out of an attempt. See useVersionRefresh.
  useVersionRefresh(gameState.phase);

  if (linkPending) {
    return <MoveGate onResolved={() => setLinkPending(false)} />;
  }

  if (bootFailed) return <CrashScreen />;

  if (showOnboarding) {
    return (
      <Shell gameState={gameState}>
        <IntroBoard
          // A fresh key IS the replay: remounting restarts the whole
          // walkthrough. It shows once per device, so replay is the only way
          // back to its last tip.
          key={introRun}
          onReplay={() => setIntroRun((n) => n + 1)}
          onDone={() => {
            // Prime the boot request NOW, synchronously before Game mounts and
            // its effects fetch, so the first load is one request instead of a
            // fan-out (the module-eval prime is skipped mid-onboarding).
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
        saver keeps retrying underneath). A staged free-play board needs no
        network until its commit, which the outbox holds, so it gets only the
        non-blocking pill; a blocking overlay would stop offline play. */
      }
      {(disconnected || failures.value >= 2) && (
        <Disconnected
          compact={gameState.freePlay && gameState.phase !== "loading"}
        />
      )}
      {
        /* Storage-blocked heads-up: game view only, never over the tour. A
          blocked browser also blocks sessionStorage, so it never collides with
          the gateToast. */
      }
      {!storagePersistent && <StorageNotice />}
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
