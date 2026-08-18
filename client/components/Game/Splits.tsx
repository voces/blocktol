import { Fragment, h } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/compat";
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
import { GameStateContext } from "./useGameState.ts";

// Open/closed sticks across visits, like the runs sort and the standings sort.
const OPEN_KEY = "splitsOpen";

// "Tap" or "Click" in the armed footer: a pointer-type question, asked once —
// the copy names the gesture the player actually has.
const COARSE = typeof matchMedia === "function" &&
  matchMedia("(pointer: coarse)").matches;

const Chevron = ({ open }: { open: boolean }) => (
  <span class={"splits__chevron" + (open ? " splits__chevron--open" : "")}>
    <svg viewBox="0 0 8 13" width={8} height={13} aria-hidden="true">
      <path
        d="M1.5 1.5L6 6.5L1.5 11.5"
        fill="none"
        stroke="currentColor"
        stroke-width={1.6}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
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

const SlowGlyph = ({ local }: { local?: boolean }) => (
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
    ? <SlowGlyph local={split.local} />
    : split.kind === "checkpoint"
    ? <CheckpointGlyph />
    : <FlagGlyph />;

// Higher is better in Blocktol, so a positive delta is a GAIN — the sign is
// spelled out because the tape is read at a glance and an unsigned "0.62" would
// invert on a loss.
const formatDelta = (delta: number) =>
  (delta > 0 ? "+" : "") + formatSeconds(delta);

const deltaClass = (delta: number | undefined) =>
  delta === undefined ? "splits__delta splits__delta--none" : "splits__delta " +
    (delta >= 0 ? "splits__delta--gain" : "splits__delta--loss");

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
    ? t("splits.slowN", { n: split.index })
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

  // Tell the board which flags this run actually crosses; the rest draw as
  // dashed outlines — speculative marks waiting for a build that routes past
  // them.
  const crossed = rows.filter((r) => r.kind === "flag").map((r) =>
    flagKey(r.at)
  ).join(" ");

  const visible = viewing && !dailyInProgress && iteration !== undefined &&
    rows.length > 0;

  useEffect(() => {
    liveFlags.value = visible
      ? new Set(crossed ? crossed.split(" ") : [])
      : undefined;
  }, [crossed, visible]);

  // Arming is a property of this panel being up: leaving the review (Play, a
  // day change, the daily) must not leave the board waiting for a flag tap.
  useEffect(() => {
    if (!visible) flagsArmed.value = false;
    return () => {
      flagsArmed.value = false;
      hoveredSplit.value = undefined;
    };
  }, [visible]);

  if (!visible) return null;

  const toggle = () => {
    storage.setItem(OPEN_KEY, open ? "0" : "1");
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
        <Chevron open={open} />
        {open ? <span class="splits__title">{t("splits.title")}</span> : (
          // Collapsed, the whole tape is the header: every mark on one
          // wrapping line — the delta against your best, or the absolute time
          // when the run on the board IS your best (nothing to compare to).
          <span class="splits__marks">
            {rows.map((split) => (
              <span class="splits__mark" key={split.key}>
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
      {open && (
        <>
          {rows.map((split) => (
            <div
              class={"splits__row" +
                (split.kind === "checkpoint" ? " splits__row--checkpoint" : "")}
              key={split.key}
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
                <span class={deltaClass(split.delta)}>
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
                    <span>{t("splits.addFlag")}</span>
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
        </>
      )}
    </div>
  );
};
