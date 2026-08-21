import { Fragment, h } from "preact";
import { useComputed } from "@preact/signals";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/compat";
import { formatSeconds } from "../../../common/format.ts";
import { computeSplits, Split, splitDeltas } from "../../../common/splits.ts";
import type { Point } from "../../../common/types.ts";
import {
  flagKey,
  flagsArmed,
  flagsFor,
  hoveredSplit,
  liveFlags,
  saveFlags,
} from "../../store/flags.ts";
import { storage } from "../../util/storage.ts";
import { t } from "../../util/t.ts";
import { localRun, mazeKey } from "./helpers.ts";
import { runnerTime } from "./interaction.ts";
import { Chevron } from "../Standings/icons.tsx";
import { GameStateContext } from "./useGameState.ts";

// Open/closed sticks across visits, like the runs sort and the standings sort.
const OPEN_KEY = "splitsOpen";

// "Tap" or "Click" in the armed footer: a pointer-type question, asked once —
// the copy names the gesture the player actually has.
const COARSE = typeof matchMedia === "function" &&
  matchMedia("(pointer: coarse)").matches;

// The same caret the standings dock uses, in the same weight and colour, so the
// rail reads as one system — but pointed differently, because the two controls
// do different things: the dock's opens a sheet (up on mobile, left into a side
// drawer on desktop), while this one is a disclosure that expands in place, so
// it points right when closed and down when open. Matching the glyph and
// diverging on direction is the honest pairing; making them identical would
// promise the same behaviour.
const Caret = ({ open }: { open: boolean }) => (
  <span class={"splits__chevron" + (open ? " splits__chevron--open" : "")}>
    <Chevron />
  </span>
);

// The three mark glyphs, each drawn in the board's own token for that piece so
// a row reads as the thing it points at: a thunder (the player's green or the
// day's magenta), the checkpoint's blue, a flag's orange.
export const FlagGlyph = ({ size = 11 }: { size?: number }) => (
  <svg
    width={size}
    height={size * 13 / 12}
    viewBox="0 0 12 13"
    class="splits__glyph"
    aria-hidden="true"
  >
    <path
      d="M2 12.5V1M2 1.5h7.5L7.6 4.6l1.9 3.1H2"
      fill="var(--flag-soft)"
      stroke="var(--flag)"
      stroke-width={1.4}
      stroke-linejoin="round"
    />
  </svg>
);

const ThunderGlyph = ({ local }: { local?: boolean }) => (
  <svg width={11} height={11} viewBox="0 0 24 24" class="splits__glyph">
    <rect
      x={2.5}
      y={2.5}
      width={19}
      height={19}
      rx={1.6}
      fill={local ? "var(--maze-player-thunder)" : "var(--maze-game-thunder)"}
      stroke="var(--maze-stroke)"
      stroke-width={2}
    />
  </svg>
);

const CheckpointGlyph = () => (
  <svg width={11} height={11} viewBox="0 0 12 12" class="splits__glyph">
    <rect
      x={1.2}
      y={1.2}
      width={9.6}
      height={9.6}
      rx={1}
      fill="var(--maze-checkpoint)"
      stroke="var(--maze-stroke)"
      stroke-width={1}
    />
  </svg>
);

const WasteIcon = () => (
  <svg width={9} height={9} viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M6 1.6a4.4 4.4 0 1 1-4.2 3.1"
      fill="none"
      stroke="currentColor"
      stroke-width={1.6}
      stroke-linecap="round"
    />
    <path
      d="M1.4 1.2v3.4h3.4"
      fill="none"
      stroke="currentColor"
      stroke-width={1.6}
      stroke-linejoin="round"
    />
  </svg>
);

const Glyph = ({ split }: { split: Split }) =>
  split.kind === "slow"
    ? <ThunderGlyph local={split.local} />
    : split.kind === "checkpoint"
    ? <CheckpointGlyph />
    : <FlagGlyph />;

// Higher is better in Blocktol, so a positive delta is a GAIN — the sign is
// spelled out because the tape is read at a glance and an unsigned "0.62" would
// invert on a loss.
const formatDelta = (delta: number) =>
  (delta > 0 ? "+" : "") + formatSeconds(delta);

// Dead level is its own state, not a gain: matching the reference exactly gets
// the warn amber rather than the win green (and not the faint grey either —
// that one already means "no counterpart in the best run", see --none).
// A tape ROW's comparison state, as a modifier that sets --split-tone: the
// delta wears it outright and the absolute time a dimmed mix of it, so the
// whole line says "ahead" or "behind" at a glance while the delta stays the
// headline. Nothing to compare against (your best run, or a mark the reference
// never crossed) leaves the default faint tone.
const rowTone = (delta: number | undefined, isBest: boolean) =>
  isBest || delta === undefined
    ? ""
    : delta === 0
    ? " splits__row--even"
    : delta > 0
    ? " splits__row--gain"
    : " splits__row--loss";

const deltaClass = (delta: number | undefined) =>
  delta === undefined
    ? "splits__delta splits__delta--none"
    : delta === 0
    ? "splits__delta splits__delta--even"
    : "splits__delta " +
      (delta > 0 ? "splits__delta--gain" : "splits__delta--loss");

// The board rectangle a hovered row rings: a thunder is a 2x2 piece anchored at
// its cell, a flag one cell, and the checkpoint the cell its half-offset anchor
// sits in (see Board.tsx, which draws it the same way).
const markRect = (split: Split) =>
  split.kind === "slow"
    ? { x: split.at.x, y: split.at.y, size: 2 }
    : split.kind === "checkpoint"
    ? { x: split.at.x + 0.5, y: split.at.y + 0.5, size: 1 }
    : { x: split.at.x, y: split.at.y, size: 1 };

const splitLabel = (split: Split) =>
  split.kind === "slow"
    ? t("splits.thunderN", { n: split.index })
    : split.kind === "flag"
    ? t("splits.flagN", { n: split.index })
    : t("splits.checkpoint");

/**
 * The splits tape: the run on the board, broken at every mark the route
 * crosses — each thunder trigger, the checkpoint, and the player's own flags —
 * read against their best run on the same board.
 *
 * It sits above the runs list and only appears while REVIEWING a run in free
 * play: mid-daily it would spoil the attempt you're building (and there's no
 * settled best to compare against yet), and on a live board there is no run to
 * describe. Everything is computed locally with the same engine the server
 * times with (`localRun` -> `computeSplits`), so the tape needs no round trip
 * and can never disagree with the time on the row.
 */
export const Splits = () => {
  const {
    viewing,
    phase,
    dailyInProgress,
    blocks,
    checkpoint,
    iteration,
    viewedAttempts,
  } = useContext(GameStateContext);
  const [open, setOpen] = useState(() => storage.getItem(OPEN_KEY) === "1");
  const armed = flagsArmed.value;
  const flags = flagsFor(iteration);

  const local = blocks.filter((b) => b.local);
  const fixed = blocks.filter((b) => !b.local);
  // Everything below is keyed off the maze on the board and the reference maze,
  // not the arrays themselves — reviewing re-creates the block objects, and the
  // solve behind this (though memoized in the shared solver) is not free.
  const key = mazeKey(local);
  const best = useMemo(
    () =>
      viewedAttempts.reduce<typeof viewedAttempts[number] | undefined>(
        (best, a) => !best || a.duration > best.duration ? a : best,
        undefined,
      ),
    [viewedAttempts],
  );
  const bestKey = best ? mazeKey(best.maze) : "";
  const isBest = !!best && bestKey === key;
  const flagsKey = flags.map(flagKey).join(" ");

  const tape = useMemo(() => {
    const run = localRun(blocks, checkpoint);
    if (!run) return undefined;
    const splits = computeSplits({
      path: run.path,
      thunders: blocks.filter((b) => b.thunder),
      checkpoint,
      flags,
    });
    // The reference is always the player's best run on this board — never a
    // per-split best pooled across runs: different builds route the runner
    // differently, so segments only compare within one route. Re-solved the
    // same way the viewed maze is (the shared solver has both mazes cached
    // after the first pass).
    if (isBest || !best) return { splits, run, deltas: undefined };
    const bestBlocks = [
      ...fixed,
      ...best.maze.map((b) => ({ ...b, local: true })),
    ];
    const bestRun = localRun(bestBlocks, checkpoint);
    if (!bestRun) return { splits, run, deltas: undefined };
    return {
      splits,
      run,
      deltas: splitDeltas(
        splits,
        computeSplits({
          path: bestRun.path,
          thunders: bestBlocks.filter((b) => b.thunder),
          checkpoint,
          flags,
        }),
      ),
    };
  }, [key, bestKey, isBest, flagsKey, checkpoint]);

  const rows: (Split & { delta?: number })[] = tape?.deltas ?? tape?.splits ??
    [];

  // While the runner is animating, the mark it is running TOWARD is lit — on
  // the collapsed line and in the expanded table alike — so the tape keeps
  // pace with the board instead of being a column of numbers you match up
  // afterwards. The split in progress, the way a speedrun timer reads: the lit
  // mark is the one about to be scored, and it moves on the instant the runner
  // reaches it. (Lighting the mark just PASSED instead leaves the tape dark
  // for the opening leg and lit on a mark the runner has already left.) Past
  // the last mark nothing is lit — there is no next one — and nothing is while
  // no runner is on the board (`runnerTime` is undefined then).
  //
  // Read through a computed, not straight in render: `runnerTime` is written
  // every frame, and a component that reads it re-renders at that rate. This
  // collapses it to a time that moves a handful of times per run, and signals
  // only notify on a CHANGED value, so the tape re-renders when the lit mark
  // moves and not otherwise. `rows` rides in on a ref because the computed is
  // created once — it is recomputed on every frame anyway, so it never reads a
  // stale board.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const currentAt = useComputed(() => {
    const at = runnerTime.value;
    if (at === undefined) return undefined;
    // Marks are in crossing order (computeSplits sorts them), so the first one
    // the runner hasn't reached is the one it's heading for. Matched by TIME,
    // not by key, so marks that share an instant light together — a flag
    // dropped on the checkpoint is one moment of the run, not two.
    return rowsRef.current.find((row) => row.time > at)?.time;
  }).value;

  // Tell the board which flags this run actually crosses; the rest draw as
  // dashed outlines — speculative marks waiting for a build that routes past
  // them. This is also what puts the flags on the board at all: unset, the
  // board draws none (see `splitsShowing`), so the marks and the tape that
  // reads them appear and go together.
  const crossed = rows.filter((r) => r.kind === "flag").map((r) =>
    flagKey(r.at)
  ).join(" ");

  // The tape describes the run the board is showing — a review, or the run
  // currently ANIMATING: a free-play run is committed and in the panel the
  // moment it executes, so its splits are readable while you watch it rather
  // than only once the runner stops. The board's blocks don't change during the
  // animation, so this is the same maze the review will settle on.
  const showing = viewing || phase === "running";
  const visible = showing && !dailyInProgress && iteration !== undefined &&
    rows.length > 0;

  useEffect(() => {
    liveFlags.value = visible
      ? new Set(crossed ? crossed.split(" ") : [])
      : undefined;
  }, [crossed, visible]);

  // Going away entirely is the one case the effect above can't cover: it only
  // rewrites `liveFlags` while this panel is mounted, and that signal is what
  // tells the board a tape is up — so an unmount would strand the flags on a
  // board with nothing left to read them against. Its own effect, deliberately:
  // folding it into the arming cleanup below would have it fire on every
  // visibility change too, racing the write that effect just made.
  useEffect(() => () => {
    liveFlags.value = undefined;
  }, []);

  // Arming is a property of this panel being up: leaving the review (Play, a
  // day change, the daily) must not leave the board waiting for a flag tap.
  useEffect(() => {
    if (!visible) flagsArmed.value = false;
    return () => {
      flagsArmed.value = false;
      hoveredSplit.value = undefined;
    };
  }, [visible]);

  // The tape comes and goes as you review a run and go back to playing, and the
  // runs list below must not hop when it does — so when it isn't up (but could
  // be: this is a free-play board), an empty panel of the collapsed height holds
  // the space. Mid-daily there is no tape to reserve for, and nothing renders.
  if (!visible) {
    return dailyInProgress || iteration === undefined
      ? null
      : <div class="splits splits--placeholder" aria-hidden="true" />;
  }

  const toggle = () => {
    storage.setItem(OPEN_KEY, open ? "0" : "1");
    // Collapsing takes the Done button off screen, so it has to disarm too —
    // otherwise the board sits waiting for a flag tap with no way to stop it.
    if (open) flagsArmed.value = false;
    setOpen(!open);
  };

  const setFlags = (next: Point[]) => saveFlags(iteration, next);

  return (
    <div class={"splits" + (open ? " splits--open" : "")}>
      <button
        type="button"
        class="splits__head tapc"
        aria-expanded={open}
        onClick={toggle}
      >
        <Caret open={open} />
        {open ? <span class="splits__title">{t("splits.title")}</span> : (
          // Collapsed, the whole tape is the header: every mark on one
          // wrapping line — the delta against your best, or the absolute time
          // when the run on the board IS your best (nothing to compare to).
          <span class="splits__marks">
            {rows.map((split) => (
              <span
                class={"splits__mark" +
                  (split.time === currentAt ? " splits__mark--current" : "")}
                key={split.key}
              >
                <Glyph split={split} />
                <span
                  class={isBest
                    ? "splits__delta splits__delta--absolute"
                    : deltaClass(split.delta)}
                >
                  {isBest
                    ? formatSeconds(split.time)
                    : split.delta === undefined
                    ? "—"
                    : formatDelta(split.delta)}
                </span>
              </span>
            ))}
          </span>
        )}
        {
          /* What the numbers mean: absolute times when this IS the best run
            (nothing to compare against), otherwise which run the deltas are
            measured from. No reference at all — a maze with no run on record —
            says nothing rather than claiming to be the best. */
        }
        {best && (
          <span class="splits__note">
            {isBest
              ? t("splits.isBest")
              : open
              ? t("splits.vsBestTime", { time: formatSeconds(best.duration) })
              : t("splits.vsBest")}
          </span>
        )}
      </button>
      {
        /* Always rendered, so opening and closing can SLIDE (a 0fr -> 1fr grid
          row, clipped by the inner wrapper) instead of snapping. Collapsed it
          is also `visibility: hidden`, which takes it out of the tab order and
          off the accessibility tree once the animation has run. */
      }
      <div class="splits__body">
        <div class="splits__body-inner">
          {rows.map((split) => (
            <div
              class={"splits__row" +
                (split.kind === "checkpoint"
                  ? " splits__row--checkpoint"
                  : "") +
                (split.time === currentAt ? " splits__row--current" : "") +
                rowTone(split.delta, isBest)}
              key={split.key}
              aria-current={split.time === currentAt ? "true" : undefined}
              onMouseEnter={() => hoveredSplit.value = markRect(split)}
              onMouseLeave={() => hoveredSplit.value = undefined}
            >
              <Glyph split={split} />
              <span class="splits__label">
                {splitLabel(split)}
                {!!split.wasted && (
                  // A re-strike resets the shared 6s slow instead of extending
                  // it, so whatever was left of the running one never lands.
                  // Shown in FINISH seconds — half the slow lost, because the
                  // runner covers slowed ground at half speed.
                  <span
                    class="splits__waste"
                    title={t("splits.wasteTitle", {
                      seconds: formatSeconds(split.wasted),
                    })}
                  >
                    <WasteIcon />
                    <span class="mono">-{formatSeconds(split.wasted)}</span>
                  </span>
                )}
              </span>
              {!isBest && (
                // Coloured by the row's tone, not its own class — the time
                // beside it takes the same tone, dimmed.
                <span class="splits__delta">
                  {split.delta === undefined ? "—" : formatDelta(split.delta)}
                </span>
              )}
              <span class="splits__time mono">{formatSeconds(split.time)}</span>
            </div>
          ))}
          <div class={"splits__foot" + (armed ? " splits__foot--armed" : "")}>
            {armed
              ? (
                <>
                  <FlagGlyph />
                  {
                    /* No saved count while armed: the desktop rail is 288px and
                      the prompt, the count and Done don't fit on one line
                      there. The count is back the moment Done is tapped, and
                      the flags themselves are on the board meanwhile. */
                  }
                  <span class="splits__arm-label">
                    {COARSE ? t("splits.armedTap") : t("splits.armedClick")}
                  </span>
                  <button
                    type="button"
                    class="splits__done tapc"
                    onClick={() => flagsArmed.value = false}
                  >
                    {t("splits.done")}
                  </button>
                </>
              )
              : (
                <>
                  <button
                    type="button"
                    class="splits__add tapc"
                    onClick={() => flagsArmed.value = true}
                  >
                    <FlagGlyph />
                    {
                      /* Same control either way; the word just says whether
                        you're starting a set or changing one that exists. */
                    }
                    <span>
                      {flags.length
                        ? t("splits.editFlags")
                        : t("splits.addFlag")}
                    </span>
                  </button>
                  <span class="splits__spacer" />
                  {flags.length > 0 && (
                    <>
                      <span class="splits__saved">
                        {t("splits.saved", { count: flags.length })}
                      </span>
                      <button
                        type="button"
                        class="splits__clear tapc"
                        onClick={() => setFlags([])}
                      >
                        {t("splits.clearAll")}
                      </button>
                    </>
                  )}
                </>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};
