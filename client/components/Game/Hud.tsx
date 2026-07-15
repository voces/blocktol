import { Fragment, h, JSX } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { showBoard, startBoardRun } from "../../store/board.ts";
import { rankedEndsAtMidnight } from "../../store/dailyRollover.ts";
import { Timer } from "../Timer.tsx";
import { clearFreePlay } from "./freePlay.ts";
import { GameStateContext } from "./useGameState.ts";
import { RunClock, VerdictPill } from "./RunClock.tsx";

const IDLE_MS = 5_000;

export const BrickIcon = () => (
  <svg width={16} height={16} viewBox="0 0 16 16">
    <rect x={0} y={0} width={16} height={16} rx={2} fill="#c0553a" />
    <g stroke="#7d331f" stroke-width={1}>
      <line x1={0} y1={5.3} x2={16} y2={5.3} />
      <line x1={0} y1={10.6} x2={16} y2={10.6} />
      <line x1={5.3} y1={0} x2={5.3} y2={5.3} />
      <line x1={10.6} y1={5.3} x2={10.6} y2={10.6} />
      <line x1={5.3} y1={10.6} x2={5.3} y2={16} />
    </g>
  </svg>
);

export const PowerIcon = () => (
  <svg width={16} height={16} viewBox="0 0 16 16">
    <g stroke="#5aa9e6" stroke-width={1.5} stroke-linecap="round">
      <line x1={8} y1={1.5} x2={8} y2={14.5} />
      <line x1={2.4} y1={4.75} x2={13.6} y2={11.25} />
      <line x1={2.4} y1={11.25} x2={13.6} y2={4.75} />
    </g>
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
 * The build-phase HUD strip above the board: brick and power counts on the left,
 * and the build clock on the right. Once a run is going the clock is tappable to
 * start it right away (setTime(0) — the same hand-off the countdown uses when it
 * reaches zero, see useInit). It cross-fades between the remaining time and
 * "Ready?" once every resource is placed or the player has been idle for a few
 * seconds, and shows "Ready?" outright while hovered or pressed. Staged free-play
 * (pre-placement) freezes it at the full time and makes it inert — the first
 * placement, not a tap, opens the run.
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

  // Reviewing a past maze leaves the board inert; a Play button is the way back
  // to a live board. If the daily's still open it returns to the "Start attempt"
  // overlay (a ranked attempt opens only from that explicit action, never as a
  // side effect of leaving a review); otherwise it free-plays the day in view.
  const onPlay = () => {
    if (attemptsRemaining > 0) {
      enterPrestart();
    } else if (iteration !== undefined) {
      showBoard(iteration);
    }
  };

  // Free-play only: discard the in-progress build. Free play never persists to
  // the server until it executes, so abandoning is just dropping the
  // client-side record — which must go FIRST, or the re-stage would resume the
  // very build we're discarding. On the live board that means re-staging fresh
  // (cached, so instant); while reviewing another maze it instead just stops
  // the abandoned build's countdown and stays on the reviewed maze — Play then
  // stages fresh rather than resuming.
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
  // Shown mid-round for free play only: after the first placement opens the run
  // and until it executes — including while reviewing a past maze with the
  // build's countdown still live (time > 0 there means exactly that; parked
  // views sit at -1). Daily runs (freePlay false) never get it.
  const showReset = freePlay && phase !== "staged" &&
    (phase !== "viewing" || time > 0);

  // Keyboard shortcut: R runs the current build now, or starts a fresh run once
  // the previous one has finished (power === -1 marks the idle/finished state).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyR" || e.metaKey || !run) return;
      if (power === -1) {
        if (iteration) startBoardRun(iteration);
      } else setTime(0);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [run, power, iteration]);

  // Idle nudge: flash "Ready?" once the player stops building for a spell. Any
  // build action (a placement, upgrade, delete, or move) touches blocks/bricks/
  // power and resets the timer.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    const t = setTimeout(() => setIdle(true), IDLE_MS);
    return () => clearTimeout(t);
  }, [blocks, bricks, power]);

  // Pressing shows "Ready?" as a commit affordance; firing is left to onClick so
  // a press that slides off the button (no click) never starts the run.
  const [pressing, setPressing] = useState(false);
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    // Drop the touch's implicit pointer capture so pointerleave fires when the
    // finger slides off, letting the label revert.
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* no capture (mouse) */ }
    setPressing(true);
  };
  const endPress = () => setPressing(false);

  const outOfResources = bricks <= 0 && power <= 0;
  const flashing = (outOfResources || idle) && !pressing;

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
      <div class="hud__controls">
        {showReset && (
          <button
            type="button"
            class="hud__reset tapc"
            aria-label="Reset board"
            title="Reset — abandon this attempt"
            onClick={onReset}
          >
            <ResetIcon />
          </button>
        )}
        {verdict
          // A milestone free-play run is executing: show its decorated verdict
          // pill (fired at commit, cleared when the board re-stages at finish —
          // see useInit). The celebration badge floats separately below.
          ? <VerdictPill verdict={verdict} />
          : phase === "staged"
          ? (
            // Free play before the first placement: the clock is frozen and
            // inert — placing a tile, not tapping, starts the run.
            <div class="hud__build hud__build--staged">
              <span class="hud__build-face hud__build-time">
                <span class="mono">{formatBuild(time)}</span>
                <span class="hud__build-label">to build</span>
              </span>
            </div>
          )
          : phase === "building"
          ? (
            <button
              type="button"
              class={"hud__build tapc" + (flashing ? " flashing" : "") +
                (pressing ? " pressing" : "")}
              onClick={() => setTime(0)}
              onPointerDown={onPointerDown}
              onPointerUp={endPress}
              onPointerLeave={endPress}
              onPointerCancel={endPress}
            >
              <span class="hud__build-face hud__build-time">
                <span class="mono">{formatBuild(time)}</span>
                <span class="hud__build-label">
                  {!freePlay && rankedEndsAtMidnight.value
                    ? "to midnight"
                    : "to build"}
                </span>
              </span>
              <span class="hud__build-face hud__build-ready">Ready?</span>
            </button>
          )
          : phase === "running" && run
          ? (
            // Same clock slot, now counting up the live run. Free play turns it
            // into the verdict — tinted to the run's live score % with the %
            // shown — while a daily attempt stays a blind stopwatch.
            freePlay
              ? <RunClock to={run.duration} min={min} best={best} />
              : (
                <div class="hud__run">
                  <span class="mono">
                    <Timer to={run.duration} />
                  </span>
                  <span class="hud__build-label">seconds</span>
                </div>
              )
          )
          : phase === "viewing"
          ? (
            // Reviewing a past maze: the clock slot becomes the way back to
            // play. With a free-play build still on the clock its countdown
            // shows in place of the "Play" label, styled like the live build
            // clock ("0:42 to build") behind the play icon — the window keeps
            // running while reviewing — and clicking resumes that build (Play
            // goes through showBoard, whose staging resumes the stored
            // attempt).
            <button type="button" class="hud__build tapc" onClick={onPlay}>
              <span class="hud__build-face hud__play">
                <span class="hud__play-icon" aria-hidden="true">▶</span>
                {time > 0
                  ? (
                    <>
                      <span class="mono">{formatBuild(time)}</span>
                      <span class="hud__build-label">to build</span>
                    </>
                  )
                  : "Play"}
              </span>
            </button>
          )
          // loading / idle (between a finished run and the next board).
          : null}
      </div>
    </div>
  );
};
