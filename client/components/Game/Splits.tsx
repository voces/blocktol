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

// Picks "Tap" or "Click" for the armed footer copy.
const COARSE = typeof matchMedia === "function" &&
  matchMedia("(pointer: coarse)").matches;

// The standings dock's caret, so the rail reads as one system, but pointed by
// behaviour: the dock opens a sheet (up or left); this expands in place (right,
// rotating down when open).
const Caret = ({ open }: { open: boolean }) => (
  <span class={"splits__chevron" + (open ? " splits__chevron--open" : "")}>
    <Chevron />
  </span>
);

// Mark glyphs, in the board's own colour tokens for each piece: thunder (the
// player's or the day's), checkpoint, flag.
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

// Higher is better, so a positive delta is a GAIN. The sign is always shown so
// an unsigned "0.62" can't be misread at a glance.
const formatDelta = (delta: number) =>
  (delta > 0 ? "+" : "") + formatSeconds(delta);

// A row's comparison state, as a modifier that sets --split-tone (the delta
// wears it, the absolute time a dimmed mix). Dead level is its own amber state,
// not a gain. Nothing to compare against (your best run, or a mark the
// reference never crossed) keeps the faint default; `--none` marks the latter.
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

// The board rectangle a hovered row rings: thunder 2x2, flag 1x1, checkpoint
// the cell its half-offset anchor sits in (as Board.tsx draws it).
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
 * It sits above the runs list and appears only for a free-play run being
 * reviewed or animating: mid-daily it would spoil the attempt being built, and
 * a live board has no run to describe. It is computed locally with the
 * server's engine (`localRun` -> `computeSplits`), so it can't disagree with
 * the time on the row.
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
  // Keyed off the mazes, not the arrays: reviewing re-creates the block
  // objects, and the solve isn't free even memoized in the shared solver.
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
    // The reference is the player's best run on this board, never a per-split
    // best pooled across runs: different builds route differently, so
    // segments only compare within one route.
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

  // While the runner animates, the mark it is running TOWARD is lit (the split
  // in progress, as a speedrun timer reads). Lighting the mark just passed
  // would leave the opening leg dark. Nothing is lit past the last mark or
  // with no runner (`runnerTime` undefined).
  //
  // Read through a computed: `runnerTime` is written every frame, and signals
  // notify only on a changed value, so the tape re-renders only when the lit
  // mark moves. `rows` rides in on a ref because the computed is created once;
  // it reruns every frame, so it never reads stale rows.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const currentAt = useComputed(() => {
    const at = runnerTime.value;
    if (at === undefined) return undefined;
    // Marks are in crossing order (`computeSplits` sorts them), so the first
    // unreached one is the target. Matched by time, not key, so marks sharing
    // an instant (a flag on the checkpoint) light together.
    return rowsRef.current.find((row) => row.time > at)?.time;
  }).value;

  // Tells the board which flags this run crosses; the rest draw dashed. Unset,
  // the board draws no flags (see `splitsShowing`), so flags and tape appear
  // together.
  const crossed = rows.filter((r) => r.kind === "flag").map((r) =>
    flagKey(r.at)
  ).join(" ");

  // The tape covers a review or the run animating: a free-play run is in the
  // panel from execution, and its maze is the one the review settles on.
  const showing = viewing || phase === "running";
  const visible = showing && !dailyInProgress && iteration !== undefined &&
    rows.length > 0;

  useEffect(() => {
    liveFlags.value = visible
      ? new Set(crossed ? crossed.split(" ") : [])
      : undefined;
  }, [crossed, visible]);

  // The effect above writes `liveFlags` only while mounted, so an unmount
  // would strand flags on a board with no tape. Separate from the cleanup
  // below, which would also fire on every visibility change and race the
  // write above.
  useEffect(() => () => {
    liveFlags.value = undefined;
  }, []);

  // Arming lasts only while the panel is up, so leaving the review can't leave
  // the board waiting for a flag tap.
  useEffect(() => {
    if (!visible) flagsArmed.value = false;
    return () => {
      flagsArmed.value = false;
      hoveredSplit.value = undefined;
    };
  }, [visible]);

  // On a free-play board without a tape, an empty panel of the collapsed
  // height holds the space so the runs list doesn't hop. Mid-daily: nothing.
  if (!visible) {
    return dailyInProgress || iteration === undefined
      ? null
      : <div class="splits splits--placeholder" aria-hidden="true" />;
  }

  const toggle = () => {
    storage.setItem(OPEN_KEY, open ? "0" : "1");
    // Collapsing hides Done, so disarm too.
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
          // Collapsed: every mark on one wrapping line, as delta against your
          // best or absolute time when this IS your best.
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
          /* What the numbers mean: absolute times, or the run the deltas are
            measured from. No reference run: no note. */
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
        /* Always rendered so it can slide (a 0fr -> 1fr grid row). Collapsed
          it is `visibility: hidden`, out of the tab order once the animation
          has run. */
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
                  // it, so the rest of the running one never lands. In finish
                  // seconds: half the slow lost (slowed ground is half speed).
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
                // Coloured by the row's tone, not its own class.
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
                    /* No saved count while armed: the 288px desktop rail
                      can't fit prompt, count and Done on one line. */
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
                      /* The label says whether this starts or edits a set. */
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
