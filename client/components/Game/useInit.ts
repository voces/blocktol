import { useCallback, useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { newGrid } from "../../../common/pathing.ts";
import { api, MessageMap } from "../../api.ts";
import { Point } from "../../../common/types.ts";
import { standing } from "../../../common/standing.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { applyRun } from "../../store/dailyItems.ts";
import { regradedIterations } from "../../store/notifications.ts";
import { entryIsDayLink } from "../../store/notifNav.ts";
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
  BoardData,
  boardSeq,
  ingestBoard,
  setBoardHandlers,
  showBoard,
} from "../../store/board.ts";
import { localRun, rebuildGrid } from "./helpers.ts";
import {
  awaitPendingCommit,
  clearFreePlay,
  freePlayClientId,
  pendingFreePlay,
  resumableFreePlay,
  setPendingCommit,
} from "./freePlay.ts";
import {
  placingBlock,
  thunderHover,
  touching,
  transitionBlock,
} from "./interaction.ts";
import {
  flushRunSaver,
  resetRunSaver,
  setRunSaverHandlers,
} from "./runSaver.ts";
import { GameStateContext } from "./useGameState.ts";
import { computeVerdict } from "./verdict.ts";

// Monotonic key for implosion ghosts, so overlapping reverts can't collide.
let implosionId = 0;

// The client's ranked build clock is run this many ms ahead of the server's true
// 60s window. The server enforces the window from the run's insert time; the
// client derives its deadline from the server's reported remaining time, but that
// response spent time in flight, leaving the client a hair LATER than the real
// close. A save fired at the client's 0 (the execute-time flush) could then reach
// the server just past 60s and come back expired — the last-second edit is lost
// and the runner executes a stale path (the persistence-revert incident). Pulling
// the client window in by this margin gives the final flush headroom to land
// inside the server window. The player loses a quarter second of build time; the
// hard 60s threshold stops booting last-second edits. Ranked only — free play is
// client-authoritative (it commits the executed maze in full) with no server
// window to race.
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
    setPower,
    setBricks,
    setBricksTotal,
    setPowerTotal,
    bricksTotal,
    powerTotal,
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
    freePlay,
    setFreePlay,
    setPrestart,
    enterPrestart,
    setViewedAttempts,
    viewedAttempts,
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

  // Keep the calendar / today panels in step with the board's attempts by
  // patching just the viewed day's item locally — no list refetch when a run
  // finishes (which, for a past day, would refetch the wrong month anyway).
  useEffect(() => {
    if (iteration !== undefined) applyRun(iteration, viewedAttempts);
  }, [iteration, viewedAttempts]);

  // A notification (lost-top / finalized daily) just moved the field for some
  // days. If the OPEN board is one of them, regrade the runs panel against the
  // new field best. Refetch only this board's attempts and swap them in — no
  // re-stage, so the clock / blocks and any in-progress build or run are
  // untouched (no phase gate needed). A 403 (today's daily unfinished, so free
  // play is still locked) just skips — there's nothing to regrade yet. The
  // calendar + standings refresh in the store regardless of what's on screen.
  const regrade = regradedIterations.value;
  useEffect(() => {
    if (iteration === undefined || !regrade.iterations.includes(iteration)) {
      return;
    }
    api.getBoard({ iteration, timeZone: getTimeZone() }).then((r) => {
      if (r && !("error" in r) && !("incomplete" in r)) {
        setViewedAttempts(r.attempts);
      }
    }).catch(() => {});
  }, [regrade.nonce]);

  // Landing on a past day's board (a /YYYYMMDD permalink or a notification deep
  // link) while today's OWN daily is still outstanding parks you on a day that
  // isn't the daily you should be playing — the same bind as a midnight
  // rollover. Reuse the rollover state so the switch-to-today affordances appear
  // (the calendar, its mobile button, and the "New daily available" banner whose
  // Play → runs playNewDaily into today's prestart); otherwise those surfaces
  // stay hidden — gated on attemptsRemaining === 0 — and there's no in-app way
  // back to the daily. Free play with attempts still remaining can only be a
  // past day: today's daily can't be free-played until its ranked attempts are
  // spent, so this never fires on today's board. Cleared by playNewDaily (the
  // switch) or a fresh boot's session pin.
  useEffect(() => {
    if (freePlay && iteration !== undefined && attemptsRemaining > 0) {
      newDailyAvailable.value = true;
    }
  }, [freePlay, iteration, attemptsRemaining]);

  // Lay the iteration's fixed pieces onto a fresh grid (a started run and a
  // staged free-play board share this reset).
  const layout = useCallback(
    (data: { checkpoint: Point; blocks: Point[] }) => {
      grid.splice(0, Infinity, ...newGrid());
      grid[data.checkpoint.y + 0.5][data.checkpoint.x + 0.5] = true;
      for (const { x, y } of data.blocks) {
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
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
      // Drop any lingering free-play verdict — a new board is loading, so the
      // previous run's celebration (which otherwise overrides the whole HUD)
      // must not carry over.
      setVerdict(undefined);
      setCheckpoint(data.checkpoint);
      setBlocks(data.blocks.map((b) => b.player ? { ...b, local: true } : b));
      // What the board resumes with IS what the server has — the revert target
      // for a later expired/rejected save.
      savedBlocksRef.current = data.blocks
        .filter((b) => b.player)
        .map((b) => ({ ...b, local: true }));
      setBricks(data.bricks);
      setPower(data.power);
      // Full budget = what's left plus what's already been placed this run, so a
      // resumed run still recovers the true total (for the review leftover chips).
      setBricksTotal(data.bricks + data.blocks.filter((b) => b.player).length);
      setPowerTotal(
        data.power + data.blocks.filter((b) => b.player && b.thunder).length,
      );
      // Wall-clock deadline for the build countdown (useClock derives the
      // display from it, immune to background-tab interval throttling). Ranked
      // play is a strictly local-day affair, so the window is hard-cut at the
      // next local midnight: an attempt started at 11:59:40 gets ~20s, and one
      // resumed after midnight (backgrounded across it) is already expired and
      // executes at once. `rankedEndsAtMidnight` lets the HUD say why it's short.
      // The 60s window is pulled in by SAVE_GRACE_MS so the execute-time flush
      // lands inside the server's window (see the constant); the midnight cut is
      // a separate hard limit and takes no grace.
      const windowEnd = Date.now() + data.remainingTime * 1000 - SAVE_GRACE_MS;
      const deadline = Math.min(windowEnd, nextLocalMidnight());
      deadlineRef.current = deadline;
      setTime(Math.max(0, Math.floor((deadline - Date.now()) / 1000)));
      rankedEndsAtMidnight.value = deadline < windowEnd;
      setDate(new Date(data.date).getTime());
      setIteration(data.iteration);
      // Field / personal bests for the free-play verdict (see verdict.ts). These
      // are the bars from *before* this run — startRun fetches them first — so a
      // run beating them reads as a fresh milestone.
      setMin(data.min);
      setBest(data.best);
      setOwnBest(data.ownBest);

      layout(data);
    },
    [],
  );

  // Free play: show the board without a run. Placement (not the clock) opens the
  // run, so the clock is staged and the whole attempt is flagged unranked.
  // `data` is either a fresh getBoard response or a cached board staged
  // optimistically (see store/board.ts) — same invariants either way.
  const handleStaged = useCallback(
    (data: BoardData) => {
      setRun(undefined);
      setFreePlay(true);
      setStaged(true);
      setPrestart(false);
      setViewing(false);
      // Clear any lingering verdict so a re-stage (reset, day change, or the
      // post-run restage) returns to the normal "to build" clock instead of the
      // old celebration pill, which otherwise overrides the HUD.
      setVerdict(undefined);
      setCheckpoint(data.checkpoint);
      // A staged board is the iteration's fixed pieces only — no player blocks
      // exist until the first placement opens the run.
      setBlocks(data.blocks.map((b) => ({ ...b })));
      savedBlocksRef.current = [];
      // A re-stage orphans any in-flight/queued save from the abandoned build;
      // drop it so a late verdict can't touch this board.
      resetRunSaver();
      setBricks(data.bricks);
      setPower(data.power);
      // A staged board has no player blocks yet, so its budget is the full total.
      setBricksTotal(data.bricks);
      setPowerTotal(data.power);
      setTime(60);
      // No countdown until the first placement's startRun response restarts
      // the clock with a fresh deadline (useClock holds still on null).
      deadlineRef.current = null;
      setDate(new Date(data.date).getTime());
      setIteration(data.iteration);
      placingBlock.value = { ...placingBlock.value, placing: false };
      transitionBlock.value = undefined;
      thunderHover.value = undefined;
      // Bests now include any run just committed, so the next free-play run is
      // judged against the updated bar.
      setMin(data.min);
      setBest(data.best);
      setOwnBest(data.ownBest);

      layout(data);

      // Resume a free-play build left in progress on this exact board — same day,
      // its local 60s window still open — from the client-side record (free play
      // keeps no server state until commit, so a reload has nothing to fetch).
      // Re-lay the saved blocks, restore the clock from the stored deadline, and
      // drop `staged` so the run is live again. Nothing resumable (committed,
      // expired, or a different day) leaves the fresh staged board untouched. The
      // record mirrors every edit, so a mid-build re-stage just restores the same
      // build.
      const resume = resumableFreePlay(data.iteration, Date.now());
      if (resume) {
        const restored = resume.blocks.map((b) => ({ ...b, local: true }));
        const merged = [...data.blocks.map((b) => ({ ...b })), ...restored];
        setBlocks(merged);
        savedBlocksRef.current = [];
        setBricks(data.bricks - restored.length);
        setPower(data.power - restored.filter((b) => b.thunder).length);
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

  // Board staging comes through the board loaders (store/board.ts) rather
  // than the response events: the loaders carry request identity, so a
  // superseded response (click day A, then quickly day B) can never stage.
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

  // Switching to the new day (playNewDaily, fired from the rollover notice)
  // re-stages its fresh prestart — reset the count to a full three optimistically
  // (the getDailySummary refresh in playNewDaily reconciles it), then raise the
  // overlay. Wired every render so it closes over current state.
  setNewDailyRestage(() => {
    setAttemptsRemaining(3);
    enterPrestart();
  });

  useApiListener(
    "getDailySummary",
    ({ attempts, ranked, currentRun }) => {
      // Pin the session to boot's local day so the rollover watcher can tell
      // when midnight has since passed (store/dailyRollover.ts). Only a real
      // boot re-pins; a mid-session refresh (time !== -2) leaves the pin, and a
      // day switch re-pins itself via playNewDaily.
      if (time === -2) pinSessionDay();

      // `attempts` is the full list (panel); `ranked` (first three) drives the
      // result modal and the attempts-remaining count.
      //
      // The server keeps the open-window run out of `attempts` — it's the
      // board, not a finished row. On boot that's right (the run resumes
      // below, and a phantom row would spoil nothing but look wrong). But the
      // post-final-attempt refetch happens moments after the run EXECUTED on
      // this client — its 60s window can still be open server-side — and
      // without folding it back in from `ranked` (same shaping) the panel
      // shows 2 of 3 rounds until the next board load.
      const panel = time === -2 ? attempts : [
        ...attempts,
        ...ranked.filter((r) => !attempts.some((a) => a.created === r.created)),
      ].sort((a, b) => a.created - b.created);
      setViewedAttempts(panel);

      if (currentRun && time === -2) {
        setAttemptsRemaining(3 - ranked.length + 1);
        // The resumed board seeds the cache too, so post-daily navigation
        // back to today stages instantly.
        ingestBoard({ ...currentRun, attempts });
        // On a day-link boot, keep the bookkeeping but don't STAGE today's run —
        // that would steal the board from the linked day. The cache seeded above
        // lets navigating home resume it instantly.
        if (!entryIsDayLink) return handleRun(currentRun);
        return;
      }

      if (ranked.length === 3) {
        setAttemptsRemaining(0);
        setAttempts(ranked);
        // The result card is (about to be) up: stage the free-play board
        // behind it now, so closing lands on a ready board instead of
        // spending the getBoard round trip at the close — and a boot onto a
        // finished daily doesn't sit on an empty board under the card.
        // (`iteration` is set post-attempt; undefined on boot = today.)
        // Skip when we booted onto a day link: today's card is hidden and
        // staging today here would race consumeDeepLink's showBoard and steal
        // the board (and the URL) back from the linked day.
        if (!entryIsDayLink) showBoard(iteration);
        return;
      }

      setAttemptsRemaining(3 - ranked.length);
      // Attempts remain and nothing's in progress: raise the explicit "Start
      // attempt" overlay over an inert board (no auto-start). Only on a real
      // boot (time === -2) — a mid-session refresh re-raises it from runFinish,
      // which fires at a safe moment and can't clobber a live build — and never
      // on a day-link boot, which stages the linked day instead.
      if (time === -2 && !entryIsDayLink) enterPrestart();
    },
  );

  useGameListener(
    "runFinish",
    () => {
      if (iteration === undefined) return;
      // The finished build's saves are history — a lingering retry must not
      // write a stale maze onto the next attempt's run.
      resetRunSaver();
      // The calendar / today panels update locally from the fresh attempts (see
      // the applyRun effect above) — no list refetch here.
      // Free play never spends a ranked attempt — it just re-stages the board.
      // The milestone celebration (if any) fired at commit, not here; clear it
      // as the board re-stages.
      if (freePlay) {
        setVerdict(undefined);
        // Wait for this attempt's commit before re-staging, so getBoard's recents
        // include the just-finished run rather than racing a slow (retrying)
        // commit and dropping it from the panel. Normally the commit is already
        // done, so this resolves immediately. Bail if the player navigated away
        // while it was still landing (only possible when the commit is slow).
        const token = boardSeq();
        awaitPendingCommit().then(() => {
          if (boardSeq() === token) showBoard(iteration);
        });
        return;
      }
      // Local midnight passed while this attempt ran — it was cut short and the
      // old day's ranked play is over (no next attempt). Raise the new-daily
      // overlay (the notice + switch) instead of re-staging the spent day; the
      // player picks up the fresh daily when they choose to. Prestart renders
      // its rollover variant off `newDailyAvailable`.
      if (rolledOver()) {
        newDailyAvailable.value = true;
        enterPrestart();
        return;
      }

      // The ranked attempt is spent. No auto-start of the next one: raise the
      // "Start attempt" overlay for the next attempt (an inert board — the
      // player opens it explicitly via `startRun`), except on the last attempt,
      // where the summary brings up the result modal instead. Decrement first
      // so the overlay reads the right attempt number immediately; the summary
      // refresh reconciles it and folds the just-finished run into the panel.
      setAttemptsRemaining((a) => Math.max(a - 1, 0));
      if (attemptsRemaining > 1) enterPrestart();
      api.getDailySummary({ iteration });
    },
    [iteration, attemptsRemaining, freePlay],
  );

  // The free-play window closed while its owner was reviewing another maze:
  // hand the board back to the build and let it execute. Restore the built
  // maze from the local record (the deadline just passed, so this is the one
  // read that must ignore the window — pendingFreePlay), recompute its run,
  // and drop `viewing`; `time` is still 0, so the execute effect below fires
  // on the restored state and commits + releases the runner exactly as if the
  // board had been live all along. An emptied/absent record restores nothing:
  // there is no attempt to execute, so the view simply stays (the clock slot
  // reverts to Play).
  useEffect(() => {
    if (time !== 0 || !viewing || !freePlay || iteration === undefined) return;
    const pending = pendingFreePlay(iteration);
    if (!pending) return;
    const restored = pending.blocks.map((b) => ({ ...b, local: true }));
    const merged = [...blocks.filter((b) => !b.local), ...restored];
    rebuildGrid(grid, checkpoint, merged);
    setBlocks(merged);
    setBricks(
      bricksTotal < 0 ? -1 : Math.max(0, bricksTotal - restored.length),
    );
    setPower(
      powerTotal < 0
        ? -1
        : Math.max(0, powerTotal - restored.filter((b) => b.thunder).length),
    );
    const r = localRun(merged, checkpoint);
    if (r) setRun(r);
    setViewing(false);
  }, [time, viewing, freePlay, iteration, blocks, checkpoint]);

  useEffect(() => {
    if (time !== 0 || !run) return;

    // The run is now executing (the clock hit 0, or the player tapped Ready / R).
    // The maze on the board is what animates and what the server must record.
    const localBlocks = blocks.filter((b) => b.local);

    // Ranked: flush any debounced/pending save NOW so the server's run row
    // matches what's about to execute. Crucially we do NOT revert to the last
    // confirmed maze — that would drop edits still sitting in the debounce, which
    // is exactly what tapping "Ready?" mid-build triggers. If the 60s window has
    // already closed the flush comes back expired and onExpired snaps the board
    // to the last accepted maze (async). Free play persists locally and commits
    // just below instead.
    if (!freePlay) flushRunSaver();

    // A free-play run counts only from this point — commit it non-void so it
    // lands in the panel and best; leaving before now kept it uncommitted
    // (abandoned). A daily attempt is already committed on build.
    if (freePlay && iteration !== undefined) {
      const maze = localBlocks.map((b) =>
        b.thunder ? { x: b.x, y: b.y, thunder: true } : { x: b.x, y: b.y }
      );
      // An empty maze (every block deleted before running) isn't a real
      // attempt: leave the run void — don't commit it — so it stays hidden
      // (free play only shows committed runs), and skip the panel row and any
      // celebration. It just runs out and re-stages.
      if (maze.length > 0) {
        // Commit-only: free play never started or updated a run on the server, so
        // the entire executed maze goes in one idempotent write, keyed by the
        // attempt's client id. The server recomputes the authoritative time from
        // it (only the 60s budget was client-enforced). It's retryable — a
        // connection dropped by a deploy retries onto a fresh isolate and lands —
        // so the run can't silently vanish the way a one-shot commit could. Hold
        // the promise so the re-stage below waits for it (see runFinish).
        const commit = api.commitRun({
          iteration,
          blocks: maze,
          clientId: freePlayClientId(),
        });
        // A commit that exhausts its retries is a real loss (a sustained outage):
        // surface it rather than letting the run disappear silently, mirroring the
        // run saver's abandonment report.
        commit.catch(() =>
          api.reportClientError({
            message: "free-play commit failed after retries",
            data: { iteration, blocks: maze.length },
          }).catch(() => {})
        );
        setPendingCommit(commit);
        // Show the run in the Runs panel the instant it starts executing, rather
        // than waiting for the runner to finish and the board to re-stage.
        // Mirrors the server's mapAttempts shaping (your best run re-normalises
        // to 100%); the re-stage's authoritative list replaces this optimistic
        // row once it lands.
        const fieldBest = Math.max(best, run.duration);
        const scored = (d: number) => standing(d, min, fieldBest);
        const supreme = run.duration > best;
        setViewedAttempts((attempts) => [
          // A supreme raises the field best, so every existing run re-scores
          // against the new ceiling (its % drops) and loses its SUPREME
          // standing — mirroring mapAttempts, which the finish re-stage
          // confirms. A non-supreme run leaves the ceiling (and the rest) as-is.
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
            created: Date.now(),
          },
        ]);
        // A free-play result is known the instant it commits, so fire the
        // milestone celebration (decorated pill + floating badge) now rather
        // than at finish — it plays over the run and clears at re-stage.
        const verdict = computeVerdict(run.duration, min, best, ownBest);
        if (verdict) setVerdict(verdict);
      }
      // The attempt has executed — drop its local resume record either way (an
      // empty maze committed nothing, but its in-progress state must not resume).
      clearFreePlay();
    }

    game.dispatchEvent("runStart", run);

    placingBlock.value = { ...placingBlock.value, placing: false };
    transitionBlock.value = undefined;
    setTime(-1);
    // Leave bricks/power as they were — the HUD keeps showing the leftover
    // counts through the run animation rather than blanking them out. The next
    // board (startRun / getBoard) resets them for the following build.
    touching.value = false;
    thunderHover.value = undefined;
  }, [time, run, freePlay, iteration, blocks, min, best, ownBest]);

  // Snap the board back to the last maze the server accepted: the optimistic
  // edit it's undoing was never persisted, so this is the maze the run will
  // actually execute. Blocks, grid, and the brick/power chips (recomputed from
  // the board's full budget) all revert together. Each removed block leaves a
  // brief implosion ghost in its place so the removal reads as deliberate.
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
      // Outlive the 0.28s animation, then drop these ghosts (later spawns
      // stay).
      setTimeout(
        () => setImplosions((cur) => cur.filter((g) => !ids.has(g.id))),
        400,
      );
    }
    rebuildGrid(grid, checkpoint, next);
    setBlocks(next);
    setBricks(bricksTotal < 0 ? -1 : bricksTotal - saved.length);
    setPower(
      powerTotal < 0 ? -1 : powerTotal - saved.filter((b) => b.thunder).length,
    );
  };

  // Wired every render so the callbacks close over fresh state. The saver
  // serializes saves and only reports verdicts for the current board
  // generation (see runSaver.ts), so these can act without re-checking.
  setRunSaverHandlers({
    onAccepted: (blocks) => {
      // The confirmed maze becomes the revert target. The DISPLAYED run is owned
      // by apply()'s local compute (the same engine the server runs), not by this
      // response: a debounced save can be a step behind the board, so echoing its
      // older path here would snap the runner backwards. Update only the revert
      // target — what a later expired/rejected save falls back to.
      savedBlocksRef.current = blocks;
    },
    onExpired: () => {
      // The server's 60s window closed before the save landed. Undo the edit
      // (it popped in optimistically but was never persisted) and start the
      // run — that's what the server is doing — rather than surfacing an
      // error. Guarded so an already-running board isn't re-zeroed, which
      // would re-fire the time-0 commit effect.
      revertToSaved();
      setTime((t) => t > 0 ? 0 : t);
    },
    // A rejected save (validation) means the server kept its previous maze:
    // undo the optimistic edit and keep building.
    onRejected: revertToSaved,
  });
};
