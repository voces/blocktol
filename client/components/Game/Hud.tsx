import { Fragment, h, JSX } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { showBoard } from "../../store/board.ts";
import { rankedEndsAtMidnight } from "../../store/dailyRollover.ts";
import { Timer } from "../Timer.tsx";
import { clearFreePlay } from "./freePlay.ts";
import { t } from "../../util/t.ts";
import { GameStateContext } from "./useGameState.ts";
import { RunClock, VerdictPill } from "./RunClock.tsx";
import { TimerRipple } from "./TimerRipple.tsx";
import { timerPulse } from "./timerPulse.ts";

const IDLE_MS = 5_000;

// The block budget: one isometric cube, in cool blue to balance the gold bolt.
export const BrickIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24">
    {/* top face (lightest) */}
    <path d="M12 2.5 L20.5 7.25 L12 12 L3.5 7.25 Z" fill="#6ea8e6" />
    {/* left face */}
    <path d="M3.5 7.25 L12 12 L12 21.5 L3.5 16.75 Z" fill="#3f7fcc" />
    {/* right face (darkest) */}
    <path d="M20.5 7.25 L12 12 L12 21.5 L20.5 16.75 Z" fill="#2f63aa" />
  </svg>
);

// The thunder budget: a gold lightning bolt.
export const PowerIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24">
    <path d="M13 2 L3.5 13.5 H11 L10 22 L20.5 10 H13 Z" fill="#f2b134" />
  </svg>
);

const ResetIcon = () => (
  <svg
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={2}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const formatBuild = (t: number) =>
  `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

/**
 * The HUD strip above the board: brick and power counts on the left, the clock
 * on the right. While building, tapping the clock executes the run at once
 * (`setTime(0)`, the hand-off the countdown makes at zero; see `useInit`). It
 * cross-fades to "Ready?" once every resource is placed or the player has been
 * idle for `IDLE_MS`, and shows it while hovered or pressed. Staged free play
 * freezes the clock at the full time and makes it inert: the first placement,
 * not a tap, opens the run.
 */
export const Hud = () => {
  const {
    bricks,
    power,
    blocks,
    phase,
    time,
    run,
    setTime,
    deadlineRef,
    iteration,
    freePlay,
    attemptsRemaining,
    enterPrestart,
    min,
    best,
    verdict,
  } = useContext(GameStateContext);

  // The way back from a review. With ranked attempts left it opens the "Start
  // attempt" overlay (a ranked attempt starts only from that explicit action);
  // otherwise it free-plays the day in view.
  const onPlay = () => {
    if (attemptsRemaining > 0) {
      enterPrestart();
    } else if (iteration !== undefined) {
      showBoard(iteration);
    }
  };

  // Free play only: discard the in-progress build by dropping the client-side
  // record, which must go FIRST or the re-stage resumes the discarded build.
  // On the live board it re-stages fresh; while reviewing it only stops the
  // countdown and stays on the reviewed maze (Play then stages fresh).
  const onReset = () => {
    if (iteration === undefined) return;
    clearFreePlay();
    if (phase === "viewing") {
      deadlineRef.current = null;
      setTime(-1);
      return;
    }
    showBoard(iteration);
  };
  // Free play only, from the first placement until execution, including a
  // review with the build's countdown still live (`time > 0`; parked views sit
  // at -1).
  const showReset = freePlay && phase !== "staged" &&
    (phase !== "viewing" || time > 0);

  // Idle nudge: any build action changes blocks/bricks/power and resets it.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    const t = setTimeout(() => setIdle(true), IDLE_MS);
    return () => clearTimeout(t);
  }, [blocks, bricks, power]);

  // Pressing shows "Ready?"; only onClick fires, so a press that slides off
  // never starts the run.
  const [pressing, setPressing] = useState(false);
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    // Drop touch's implicit capture so pointerleave fires on slide-off.
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* no capture (mouse) */ }
    setPressing(true);
  };
  const endPress = () => setPressing(false);

  const outOfResources = bricks <= 0 && power <= 0;
  const flashing = (outOfResources || idle) && !pressing;

  // Each countdown mark bumps `timerPulse` (see TimerRipple) and the button
  // plays a "drop" in sync. State, not a DOM class toggle, so the per-second
  // re-render can't clobber the class mid-animation; onAnimationEnd clears it.
  const pulse = timerPulse.value;
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (pulse > 0) setDropping(true);
  }, [pulse]);

  return (
    <div class="hud">
      <div class="hud__chips">
        {bricks >= 0 && (
          <div class="hud__chip">
            <BrickIcon />
            <span class="mono">{bricks}</span>
          </div>
        )}
        {power >= 0 && (
          <div class="hud__chip">
            <PowerIcon />
            <span class="mono">{power}</span>
          </div>
        )}
      </div>
      <TimerRipple />
      <div class="hud__controls">
        {showReset && (
          <button
            type="button"
            class="hud__reset tapc"
            aria-label={t("hud.reset")}
            title={t("hud.resetTitle")}
            onClick={onReset}
          >
            <ResetIcon />
          </button>
        )}
        {verdict
          // A milestone free-play run is executing: its verdict pill (set at
          // commit, cleared on the finish re-stage; see `useInit`).
          ? <VerdictPill verdict={verdict} />
          : phase === "staged"
          ? (
            // Frozen and inert: the first placement starts the run.
            <div class="hud__build hud__build--staged">
              <span class="hud__build-face hud__build-time">
                <span class="mono">{formatBuild(time)}</span>
                <span class="hud__build-label">{t("hud.toBuild")}</span>
              </span>
            </div>
          )
          : phase === "building"
          ? (
            <button
              type="button"
              class={"hud__build tapc" + (flashing ? " flashing" : "") +
                (pressing ? " pressing" : "") + (dropping ? " dropping" : "")}
              onClick={() => setTime(0)}
              onPointerDown={onPointerDown}
              onPointerUp={endPress}
              onPointerLeave={endPress}
              onPointerCancel={endPress}
              onAnimationEnd={(e) => {
                if (e.animationName === "buildDrop") setDropping(false);
              }}
            >
              <span class="hud__build-face hud__build-time">
                <span class="mono">{formatBuild(time)}</span>
                <span class="hud__build-label">
                  {!freePlay && rankedEndsAtMidnight.value
                    ? t("hud.toMidnight")
                    : t("hud.toBuild")}
                </span>
              </span>
              <span class="hud__build-face hud__build-ready">
                {t("hud.ready")}
              </span>
            </button>
          )
          : phase === "running" && run
          ? (
            // Counts up the live run. Free play shows the verdict (tinted to
            // the live score %); a daily attempt stays a blind stopwatch.
            freePlay
              ? <RunClock to={run.duration} min={min} best={best} />
              : (
                <div class="hud__run">
                  <span class="mono">
                    <Timer to={run.duration} />
                  </span>
                  <span class="hud__build-label">{t("hud.seconds")}</span>
                </div>
              )
          )
          : phase === "viewing"
          ? (
            // Reviewing: the way back to play. A free-play build still on the
            // clock shows its countdown in place of "Play"; clicking resumes it
            // (`showBoard` staging resumes the stored attempt).
            <button type="button" class="hud__build tapc" onClick={onPlay}>
              <span class="hud__build-face hud__play">
                <span class="hud__play-icon" aria-hidden="true">▶</span>
                {time > 0
                  ? (
                    <>
                      <span class="mono">{formatBuild(time)}</span>
                      <span class="hud__build-label">{t("hud.toBuild")}</span>
                    </>
                  )
                  : t("hud.play")}
              </span>
            </button>
          )
          // loading / idle (between a finished run and the next board).
          : null}
      </div>
    </div>
  );
};
