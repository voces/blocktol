import { h, JSX } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { showBoard, startBoardRun } from "../../store/board.ts";
import { Timer } from "../Timer.tsx";
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
    time,
    run,
    setTime,
    iteration,
    staged,
    freePlay,
    viewing,
    attemptsRemaining,
    min,
    best,
    verdict,
  } = useContext(GameStateContext);

  // Reviewing a past maze leaves the board inert; a Play button is the way back
  // to a live board. If the daily's still open it resumes the ranked run;
  // otherwise it free-plays the day currently in view.
  const onPlay = () => {
    if (attemptsRemaining > 0) {
      startBoardRun("daily");
    } else if (iteration !== undefined) {
      showBoard(iteration);
    }
  };

  // Free-play only: re-stage a fresh board, discarding the in-progress build.
  // A free-play run is void until it executes (see commitRun), so simply
  // re-staging abandons it — no explicit void call needed. The board is
  // cached, so the reset is instant.
  const onReset = () => {
    if (iteration === undefined) return;
    showBoard(iteration);
  };
  // Shown mid-round for free play only: after the first placement opens the run
  // (staged is false) and while not reviewing a past maze. Daily runs (freePlay
  // false) never get it.
  const showReset = freePlay && !staged && !viewing;

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
  const flashing = (outOfResources || idle) && !pressing && !staged;

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
          : time > 0
          ? staged
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
            : (
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
                  <span class="hud__build-label">to build</span>
                </span>
                <span class="hud__build-face hud__build-ready">Ready?</span>
              </button>
            )
          : run && time < 0
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
          : viewing
          ? (
            // Reviewing a past maze: the clock slot becomes the way back to play.
            <button type="button" class="hud__build tapc" onClick={onPlay}>
              <span class="hud__build-face hud__play">
                <span class="hud__play-icon" aria-hidden="true">▶</span>
                Play
              </span>
            </button>
          )
          : null}
      </div>
    </div>
  );
};
