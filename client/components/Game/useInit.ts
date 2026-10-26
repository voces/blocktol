import { useCallback, useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { newGrid } from "../../../common/pathing.ts";
import { api, type MessageMap } from "../../api.ts";
import { type Point } from "../../../common/types.ts";
import { standing } from "../../../common/standing.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { applyRun } from "../../store/dailyItems.ts";
import { regradedIterations } from "../../store/notifications.ts";
import { stagingPastDayLink } from "../../store/notifNav.ts";
import { useGame, useGameListener } from "../../hooks/useGame.ts";
import { getTimeZone } from "../../util/timeZone.ts";
import { nextLocalMidnight } from "../../util/dayBoundary.ts";
import {
  newDailyAvailable,
  pinSessionDay,
  rankedEndsAtMidnight,
  rolledOver,
  setNewDailyRestage,
} from "../../store/dailyRollover.ts";
import {
  type BoardData,
  boardSeq,
  ingestBoard,
  setBoardHandlers,
  showBoard,
  takeLostStart,
} from "../../store/board.ts";
import { localRun, rebuildGrid } from "./helpers.ts";
import {
  awaitPendingCommit,
  clearFreePlay,
  commitFreePlay,
  pendingFreePlay,
  resumableFreePlay,
  setPendingCommit,
} from "./freePlay.ts";
import {
  clearTouchZoom,
  placingBlock,
  thunderHover,
  transitionBlock,
} from "./interaction.ts";
import {
  beginRunTrace,
  flushRunSaver,
  resetRunSaver,
  setRunSaverHandlers,
} from "./runSaver.ts";
import { GameStateContext } from "./useGameState.ts";
import { computeVerdict } from "./verdict.ts";

// Monotonic key for implosion ghosts, so overlapping reverts can't collide.
let implosionId = 0;

// The ranked build clock runs this many ms ahead of the server's 60s window.
// The client deadline derives from the server's reported remaining time, which
// spent time in flight, so it lands slightly LATER than the real close. The
// execute-time flush could then arrive past 60s and come back expired, losing
// the last-second edit (the persistence-revert incident). Ranked only: free
// play has no server window to race.
const SAVE_GRACE_MS = 250;

export const useInit = () => {
  const game = useGame();
  const {
    setTime,
    grid,
    setBlocks,
    savedBlocksRef,
    setImplosions,
    deadlineRef,
    setBricksTotal,
    setPowerTotal,
    checkpoint,
    setRun,
    setCheckpoint,
    setDate,
    setAttempts,
    time,
    attemptsRemaining,
    setAttemptsRemaining,
    run,
    iteration,
    setIteration,
    setStaged,
    staged,
    prestart,
    freePlay,
    setFreePlay,
    setPrestart,
    enterPrestart,
    setViewedAttempts,
    viewedAttempts,
    viewMaze,
    viewing,
    setViewing,
    blocks,
    min,
    setMin,
    best,
    setBest,
    ownBest,
    setOwnBest,
    setVerdict,
  } = useContext(GameStateContext);

  // Patch the viewed day's calendar / today item locally when attempts change;
  // a list refetch would fetch the wrong month for a past day.
  useEffect(() => {
    if (iteration !== undefined) applyRun(iteration, viewedAttempts);
  }, [iteration, viewedAttempts]);

  // A notification (lost-top / finalized daily) moved the field for some days.
  // If the OPEN board is one, refetch only its attempts and swap them in: no
  // re-stage, so a live build or run is untouched. An { incomplete } board is
  // skipped, and that is the COMMON case: a lost-top notification fires at
  // players with a build on today's unfinished board (see
  // store/notifications.ts).
  const regrade = regradedIterations.value;
  useEffect(() => {
    if (iteration === undefined || !regrade.iterations.includes(iteration)) {
      return;
    }
    api.getBoard({ iteration, timeZone: getTimeZone() }).then((r) => {
      if (!("error" in r) && !("incomplete" in r)) {
        setViewedAttempts(r.attempts);
      }
    }).catch(() => {});
  }, [regrade.nonce]);

  // Landing on a past day (a /YYYYMMDD permalink or notification link) while
  // today's own daily is outstanding is the same bind as a midnight rollover.
  // Reuse the rollover state so the switch-to-today affordances (calendar,
  // "New daily available" banner -> playNewDaily) appear; they are otherwise
  // gated on attemptsRemaining === 0, leaving no way back to the daily. Free
  // play with attempts remaining can only be a past day, since today's daily
  // can't be free-played until its ranked attempts are spent. Cleared by
  // playNewDaily or a fresh boot's session pin.
  useEffect(() => {
    if (freePlay && iteration !== undefined && attemptsRemaining > 0) {
      newDailyAvailable.value = true;
    }
  }, [freePlay, iteration, attemptsRemaining]);

  // Lay the iteration's fixed pieces onto a fresh grid (shared by a started run
  // and a staged free-play board).
  const layout = useCallback(
    (data: { checkpoint: Point; blocks: Point[] }) => {
      grid.splice(0, Infinity, ...newGrid());
      grid[data.checkpoint.y + 0.5]![data.checkpoint.x + 0.5] = true;
      for (const { x, y } of data.blocks) {
        offsets.forEach(([xd, yd]) => grid[y + yd]![x + xd] = true);
      }
    },
    [],
  );

  const handleRun = useCallback(
    (data: NonNullable<MessageMap["getDailySummary"]["currentRun"]>) => {
      setRun({ path: data.path, duration: data.duration, slows: data.slows });
      setStaged(false);
      setPrestart(false);
      setViewing(false);
      // A lingering free-play verdict would override the whole HUD.
      setVerdict(undefined);
      setCheckpoint(data.checkpoint);
      setBlocks(data.blocks.map((b) => b.player ? { ...b, local: true } : b));
      // What the board resumes with is what the server has: the revert target
      // for a later expired/rejected save.
      savedBlocksRef.current = data.blocks
        .filter((b) => b.player)
        .map((b) => ({ ...b, local: true }));
      // The edit trace diffs from the maze the server holds.
      beginRunTrace(savedBlocksRef.current);
      // Total = what's left plus what's already placed, so a resumed run
      // recovers the true budget (the HUD counts derive in useGameState).
      setBricksTotal(data.bricks + data.blocks.filter((b) => b.player).length);
      setPowerTotal(
        data.power + data.blocks.filter((b) => b.player && b.thunder).length,
      );
      // Wall-clock deadline for the countdown (useClock derives the display
      // from it). Ranked play is hard-cut at the next local midnight: an
      // attempt started at 11:59:40 gets ~20s, and one resumed after midnight
      // executes at once. `rankedEndsAtMidnight` lets the HUD say why it's
      // short. Only the 60s window takes SAVE_GRACE_MS; the midnight cut takes
      // none.
      const windowEnd = Date.now() + data.remainingTime * 1000 - SAVE_GRACE_MS;
      const deadline = Math.min(windowEnd, nextLocalMidnight());
      deadlineRef.current = deadline;
      setTime(Math.max(0, Math.floor((deadline - Date.now()) / 1000)));
      rankedEndsAtMidnight.value = deadline < windowEnd;
      setDate(new Date(data.date).getTime());
      setIteration(data.iteration);
      // Bars from before this run (startRun fetches them first) for the
      // free-play verdict (see verdict.ts).
      setMin(data.min);
      setBest(data.best);
      setOwnBest(data.ownBest);

      layout(data);
    },
    [],
  );

  // Free play: show the board without a run. Placement, not the clock, opens
  // the run. `data` is a getBoard response or a cached board staged
  // optimistically (see store/board.ts).
  const handleStaged = useCallback(
    (data: BoardData) => {
      setRun(undefined);
      setFreePlay(true);
      setStaged(true);
      setPrestart(false);
      setViewing(false);
      // A lingering verdict pill would override the HUD's "to build" clock.
      setVerdict(undefined);
      setCheckpoint(data.checkpoint);
      // Fixed pieces only; player blocks appear with the first placement.
      setBlocks(data.blocks.map((b) => ({ ...b })));
      savedBlocksRef.current = [];
      // Drop any in-flight/queued save from the abandoned build so a late
      // verdict can't touch this board.
      resetRunSaver();
      setBricksTotal(data.bricks);
      setPowerTotal(data.power);
      setTime(60);
      // No countdown until the first placement sets a deadline (useClock holds
      // still on null).
      deadlineRef.current = null;
      setDate(new Date(data.date).getTime());
      setIteration(data.iteration);
      placingBlock.value = { ...placingBlock.value, placing: false };
      transitionBlock.value = undefined;
      thunderHover.value = undefined;
      // Bests include any run just committed.
      setMin(data.min);
      setBest(data.best);
      setOwnBest(data.ownBest);

      layout(data);

      // Resume a free-play build in progress on this board (same iteration,
      // local 60s window still open) from the client-side record; the server
      // holds nothing until commit. Nothing resumable leaves the staged board
      // untouched.
      const resume = resumableFreePlay(data.iteration, Date.now());
      if (resume) {
        const restored = resume.blocks.map((b) => ({ ...b, local: true }));
        const merged = [...data.blocks.map((b) => ({ ...b })), ...restored];
        setBlocks(merged);
        savedBlocksRef.current = [];
        rebuildGrid(grid, data.checkpoint, merged);
        const r = localRun(merged, data.checkpoint);
        if (r) setRun(r);
        setStaged(false);
        deadlineRef.current = resume.deadline;
        setTime(Math.max(0, Math.ceil((resume.deadline - Date.now()) / 1_000)));
      }
    },
    [],
  );

  // Staging goes through the board loaders (store/board.ts), not response
  // events: the loaders carry request identity, so a superseded response can
  // never stage.
  setBoardHandlers({
    onRun: (e) => {
      handleRun(e);
      setViewedAttempts(e.attempts);
    },
    onStaged: (e) => {
      handleStaged(e);
      setViewedAttempts(e.attempts);
    },
  });

  // playNewDaily (from the rollover notice) re-stages the new day's prestart:
  // set three attempts optimistically (its getDailySummary refresh reconciles),
  // then raise the overlay. Wired every render to close over current state.
  setNewDailyRestage(() => {
    setAttemptsRemaining(3);
    enterPrestart();
  });

  useApiListener(
    "getDailySummary",
    ({ attempts, ranked, currentRun }) => {
      // Pin the session to boot's local day so the rollover watcher can tell
      // when midnight has passed (store/dailyRollover.ts). Only a real boot
      // (time === -2) re-pins; playNewDaily re-pins on a day switch.
      if (time === -2) pinSessionDay();

      // Re-check after a ranked Start lost its answer (startDailyRun): one more
      // ranked run than were spent, with a window open, means the server DID
      // open the attempt. Resume it as a boot would instead of offering a
      // second Start that burns another. Handled first: the branches below
      // read this summary as "nothing in progress".
      const lost = takeLostStart();
      if (lost !== null && currentRun && ranked.length > lost) {
        setAttemptsRemaining(3 - ranked.length + 1);
        ingestBoard({ ...currentRun, attempts });
        handleRun(currentRun);
        setViewedAttempts(attempts);
        return;
      }

      // `attempts` is the full list (panel); `ranked` (first three) drives the
      // result modal and the attempts-remaining count.
      //
      // The server keeps the open-window run out of `attempts`. That is right
      // on boot (the run resumes below), but a refetch right after a run
      // EXECUTED here can still find its window open server-side, so it is
      // folded back in from `ranked`; otherwise the panel shows 2 of 3 rounds.
      const panel = time === -2 ? attempts : [
        ...attempts,
        ...ranked.filter((r) => !attempts.some((a) => a.created === r.created)),
      ].sort((a, b) => a.created - b.created);
      setViewedAttempts(panel);

      if (currentRun && time === -2) {
        setAttemptsRemaining(3 - ranked.length + 1);
        // Seeds the cache so navigating back to today stages instantly.
        ingestBoard({ ...currentRun, attempts });
        // On a PAST-day-link boot don't STAGE today's run: it would steal the
        // board from the linked day. A today-link resumes it normally.
        if (!stagingPastDayLink()) return handleRun(currentRun);
        return;
      }

      if (ranked.length === 3) {
        setAttemptsRemaining(0);
        setAttempts(ranked);
        // The result card is up: stage the free-play board behind it so
        // closing lands on a ready board. (`iteration` is set post-attempt;
        // undefined on boot = today.) Skip on a PAST-day-link boot: staging
        // today would race consumeDeepLink's showBoard and steal the board
        // (and URL) from the linked day. A today-link stages here, and
        // consumeDeepLink steps aside for it.
        if (!stagingPastDayLink()) void showBoard(iteration);
        return;
      }

      setAttemptsRemaining(3 - ranked.length);
      // Attempts remain and nothing is in progress: raise the "Start attempt"
      // overlay over an inert board. Only on a real boot (time === -2; a
      // mid-session refresh re-raises it from runFinish, which can't clobber a
      // live build) and never on a PAST-day-link boot, which stages the linked
      // day. A today-link falls through to the prestart.
      if (time === -2 && !stagingPastDayLink()) enterPrestart();
    },
  );

  useGameListener(
    "runFinish",
    () => {
      if (iteration === undefined) return;
      // A runner released over a REVIEW (viewMaze replay) is not an attempt
      // finishing: nothing to commit, re-stage or spend (BoardArea's onFinish
      // clears the run).
      if (viewing) return;
      // A lingering retry must not write the finished build's stale maze onto
      // the next attempt's run.
      resetRunSaver();
      // Free play never spends a ranked attempt; it re-stages the board. Its
      // milestone celebration fired at commit, so clear it here.
      if (freePlay) {
        setVerdict(undefined);
        // The maze that just ran, captured before the re-stage.
        const executed = blocks.filter((b) => b.local).map((b) =>
          b.thunder ? { x: b.x, y: b.y, thunder: true } : { x: b.x, y: b.y }
        );
        // Wait for this attempt's commit so getBoard's recents include the run
        // instead of racing a slow (retrying) commit. Bail if the player
        // navigated away meanwhile.
        const token = boardSeq();
        void awaitPendingCommit().then(() => {
          if (boardSeq() !== token) return;
          // The re-stage refreshes the board's bests and recents, then the
          // executed maze is overlaid as a review so the run just watched stays
          // up. The stage must land first: it lays out the day's fixed pieces.
          // `staged` means this request took the board, so it is the only guard
          // the overlay needs. An empty maze has nothing to review.
          void showBoard(iteration).then((staged) => {
            // No replay: the run just finished animating.
            if (staged && executed.length) {
              viewMaze(executed, { replay: false });
            }
          });
        });
        return;
      }
      // Local midnight passed mid-attempt: the old day's ranked play is over.
      // Raise the new-daily overlay (prestart renders its rollover variant off
      // `newDailyAvailable`) instead of re-staging the spent day.
      if (rolledOver()) {
        newDailyAvailable.value = true;
        enterPrestart();
        return;
      }

      // The ranked attempt is spent. Raise the "Start attempt" overlay for the
      // next one (never auto-start), except after the last, where the summary
      // brings up the result modal. Decrement first so the overlay reads the
      // right attempt number; the summary refresh reconciles it.
      setAttemptsRemaining((a) => Math.max(a - 1, 0));
      if (attemptsRemaining > 1) enterPrestart();
      void api.getDailySummary({ iteration });
    },
    [iteration, attemptsRemaining, freePlay, blocks, viewing],
  );

  // The free-play window closed while its owner was reviewing another maze:
  // hand the board back to the build and let it execute. The maze comes from
  // the local record via pendingFreePlay, the one read that ignores the
  // (just passed) deadline. Dropping `viewing` with `time` still 0 fires the
  // execute effect below. An empty or absent record restores nothing and the
  // view stays.
  useEffect(() => {
    if (time !== 0 || !viewing || !freePlay || iteration === undefined) return;
    const pending = pendingFreePlay(iteration);
    if (!pending) return;
    const restored = pending.blocks.map((b) => ({ ...b, local: true }));
    const merged = [...blocks.filter((b) => !b.local), ...restored];
    rebuildGrid(grid, checkpoint, merged);
    setBlocks(merged);
    const r = localRun(merged, checkpoint);
    if (r) setRun(r);
    setViewing(false);
  }, [time, viewing, freePlay, iteration, blocks, checkpoint]);

  useEffect(() => {
    // Only a LIVE build executes. This is the line that writes, so it checks
    // for itself: a review, staged board or prestart overlay must never commit
    // or spend, whatever drove `time` to 0. (The expiry hand-off above drops
    // `viewing` first when a build really is due.)
    if (time !== 0 || !run || viewing || staged || prestart) return;

    // The maze on the board is what animates and what the server must record.
    const localBlocks = blocks.filter((b) => b.local);

    // Ranked: flush the pending save NOW so the server's run matches what
    // executes. Do NOT revert to the last confirmed maze: that drops edits
    // still in the debounce, which tapping "Ready?" mid-build triggers. If the
    // window already closed, the flush comes back expired and onExpired snaps
    // the board back (async).
    if (!freePlay) flushRunSaver();

    // A free-play run counts only from here: commit it non-void. A daily
    // attempt is already committed on build.
    if (freePlay && iteration !== undefined) {
      const maze = localBlocks.map((b) =>
        b.thunder ? { x: b.x, y: b.y, thunder: true } : { x: b.x, y: b.y }
      );
      // An empty maze (every block deleted) isn't an attempt: commit nothing,
      // add no panel row or celebration; it runs out and re-stages.
      if (maze.length > 0) {
        // Free play touches the server once: the whole maze in one idempotent
        // write keyed by the attempt's client id; the server recomputes the
        // time. It is retryable and goes through the commit outbox
        // (freePlay.ts), which holds the maze until the server answers, so a
        // commit that outlasts its retries is re-sent at the next boot or
        // `online`. The re-stage waits on the promise (see runFinish).
        const commit = commitFreePlay(iteration, maze, run.duration);
        // An exhausted commit stays in the outbox but signals a sustained
        // outage worth seeing, like the run saver's abandonment report.
        commit.catch(() =>
          api.reportClientError({
            message: "free-play commit failed after retries (queued)",
            data: { iteration, blocks: maze.length },
          }).catch(() => {})
        );
        setPendingCommit(commit);
        // The optimistic panel row below carries a provisional local `created`.
        // `created` is also the pin key, matched server-side against
        // UNIX_TIMESTAMP(created) * 1000, which a client wall-clock ms never
        // equals, so pinning the running run would silently no-op. Swap in the
        // server's `created` once the commit lands.
        const provisionalCreated = Date.now();
        commit.then((r) => {
          const created = !("error" in r) ? r.created : null;
          if (created == null) return;
          setViewedAttempts((attempts) =>
            attempts.map((a) =>
              a.created === provisionalCreated ? { ...a, created } : a
            )
          );
        }).catch(() => {});
        // Show the run in the Runs panel at once, mirroring the server's
        // mapAttempts shaping; the re-stage's list replaces this row.
        const fieldBest = Math.max(best, run.duration);
        const scored = (d: number) => standing(d, min, fieldBest);
        const supreme = run.duration > best;
        setViewedAttempts((attempts) => [
          // A supreme raises the field best, so existing runs re-score against
          // it and lose their SUPREME standing (as mapAttempts does).
          ...(supreme
            ? attempts.map((a) => ({
              ...a,
              percent: scored(a.duration),
              supreme: false,
            }))
            : attempts),
          {
            duration: run.duration,
            percentile: undefined,
            percent: scored(run.duration),
            supreme,
            ranked: false,
            pinned: false,
            maze,
            created: provisionalCreated,
          },
        ]);
        // The result is known at commit: celebrate now, over the run; it
        // clears at re-stage.
        const verdict = computeVerdict(run.duration, min, best, ownBest);
        if (verdict) setVerdict(verdict);
      }
      // Drop the local RESUME record either way, so an empty maze doesn't
      // resume. A non-empty maze is kept by the commit outbox.
      clearFreePlay();
    }

    game.dispatchEvent("runStart", run);

    placingBlock.value = { ...placingBlock.value, placing: false };
    transitionBlock.value = undefined;
    setTime(-1);
    // The executed maze stays on the board through the animation, so the HUD
    // keeps this run's leftover counts until the next board brings a budget.
    clearTouchZoom();
    thunderHover.value = undefined;
  }, [
    time,
    run,
    freePlay,
    iteration,
    blocks,
    min,
    best,
    ownBest,
    viewing,
    staged,
    prestart,
  ]);

  // Snap the board back to the last maze the server accepted (the undone edit
  // was never persisted). Blocks, grid and the derived chips revert together;
  // each removed block leaves a brief implosion ghost.
  const revertToSaved = () => {
    const saved = savedBlocksRef.current;
    const next = [...blocks.filter((b) => !b.local), ...saved];
    const removed = blocks.filter(
      (b) => b.local && !saved.some((s) => s.x === b.x && s.y === b.y),
    );
    if (removed.length) {
      const ghosts = removed.map((b) => ({
        x: b.x,
        y: b.y,
        thunder: b.thunder,
        id: ++implosionId,
      }));
      const ids = new Set(ghosts.map((g) => g.id));
      setImplosions((cur) => [...cur, ...ghosts]);
      // Outlive the 0.28s animation, then drop these ghosts.
      setTimeout(
        () => setImplosions((cur) => cur.filter((g) => !ids.has(g.id))),
        400,
      );
    }
    rebuildGrid(grid, checkpoint, next);
    setBlocks(next);
    // The run reverts with the maze, else the runner and HUD time keep the
    // undone edit's run. An expired save usually reverts after the runner was
    // released; swapping the path restarts the walk on the server's maze
    // (Runner keys its animation on the path).
    const r = localRun(next, checkpoint);
    if (r) setRun(r);
  };

  // Wired every render to close over fresh state. The saver reports verdicts
  // only for the current board generation (see runSaver.ts), so these can act
  // without re-checking.
  setRunSaverHandlers({
    onAccepted: (blocks) => {
      // Only the revert target updates. The displayed run belongs to
      // useInputEnd's local compute: a debounced save can trail the board, and
      // echoing its older path would snap the runner backwards.
      savedBlocksRef.current = blocks;
    },
    onExpired: () => {
      // The server's 60s window closed first. Undo the unpersisted edit and
      // start the run, as the server is doing. Guarded so a running board
      // isn't re-zeroed, which would re-fire the time-0 commit effect.
      revertToSaved();
      setTime((t) => t > 0 ? 0 : t);
    },
    // A rejected save (validation): the server kept its previous maze.
    onRejected: revertToSaved,
  });
};
