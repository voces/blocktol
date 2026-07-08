import { useCallback, useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { newGrid } from "../../../common/pathing.ts";
import { api, MessageMap } from "../../api.ts";
import { Point } from "../../../common/types.ts";
import { standing } from "../../../common/standing.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { applyRun } from "../../store/dailyItems.ts";
import { useGame, useGameListener } from "../../hooks/useGame.ts";
import { getTimeZone } from "../../util/timeZone.ts";
import {
  BoardData,
  ingestBoard,
  setBoardHandlers,
  showBoard,
  startBoardRun,
} from "../../store/board.ts";
import { rebuildGrid } from "./helpers.ts";
import {
  finalizeRunSaver,
  resetRunSaver,
  setRunSaverHandlers,
} from "./runSaver.ts";
import { GameStateContext } from "./useGameState.ts";
import { computeVerdict } from "./verdict.ts";

// Monotonic key for implosion ghosts, so overlapping reverts can't collide.
let implosionId = 0;

export const useInit = () => {
  const game = useGame();
  const {
    setTime,
    setPlacingBlock,
    grid,
    setThunderHover,
    setTransitionBlock,
    setTouching,
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
    setViewedAttempts,
    viewedAttempts,

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
      setTime(Math.floor(data.remainingTime));
      // Wall-clock deadline for the build countdown (useClock derives the
      // display from it, immune to background-tab interval throttling).
      deadlineRef.current = Date.now() + data.remainingTime * 1000;
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
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      setTransitionBlock(undefined);
      setThunderHover(undefined);
      // Bests now include any run just committed, so the next free-play run is
      // judged against the updated bar.
      setMin(data.min);
      setBest(data.best);
      setOwnBest(data.ownBest);

      layout(data);
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

  useApiListener(
    "getDailySummary",
    ({ attempts, ranked, currentRun }) => {
      // `attempts` is the full list (panel); `ranked` (first three) drives the
      // result modal and the attempts-remaining count.
      setViewedAttempts(attempts);

      if (currentRun && time === -2) {
        setAttemptsRemaining(3 - ranked.length + 1);
        // The resumed board seeds the cache too, so post-daily navigation
        // back to today stages instantly.
        ingestBoard({ ...currentRun, attempts });
        return handleRun(currentRun);
      }

      if (ranked.length === 3) {
        setAttemptsRemaining(0);
        return setAttempts(ranked);
      }

      setAttemptsRemaining(3 - ranked.length);
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
        showBoard(iteration);
        return;
      }
      setAttemptsRemaining((a) => Math.max(a - 1, 0));
      if (attemptsRemaining === 1) api.getDailySummary({ iteration });
      else startBoardRun(iteration);
    },
    [iteration, attemptsRemaining, freePlay],
  );

  useEffect(() => {
    if (time !== 0 || !run) return;

    // The run is now executing: nothing unconfirmed can make it in anymore.
    // Cancel pending saves/retries, and if an edit never confirmed, snap back
    // to the accepted maze (its blocks implode) so what animates — and what
    // free play commits below — matches what the server executes.
    const reverted = finalizeRunSaver();
    if (reverted) revertToSaved();
    const localBlocks = reverted
      ? savedBlocksRef.current
      : blocks.filter((b) => b.local);

    // The run is now executing (the clock hit 0, or the player tapped start / R).
    // A free-play run counts only from this point — commit it non-void so it
    // lands in the panel and best; leaving before now kept it void (abandoned).
    // A daily attempt is already committed on build, so it's left alone.
    if (freePlay && iteration !== undefined) {
      const maze = localBlocks.map((b) =>
        b.thunder ? { x: b.x, y: b.y, thunder: true } : { x: b.x, y: b.y }
      );
      // An empty maze (every block deleted before running) isn't a real
      // attempt: leave the run void — don't commit it — so it stays hidden
      // (free play only shows committed runs), and skip the panel row and any
      // celebration. It just runs out and re-stages.
      if (maze.length > 0) {
        api.commitRun({ iteration });
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
    }

    game.dispatchEvent("runStart", run);

    setPlacingBlock((pb) => ({ ...pb, placing: false }));
    setTransitionBlock(undefined);
    setTime(-1);
    // Leave bricks/power as they were — the HUD keeps showing the leftover
    // counts through the run animation rather than blanking them out. The next
    // board (startRun / getBoard) resets them for the following build.
    setTouching(false);
    setThunderHover(undefined);
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
    onAccepted: (blocks, r) => {
      // The confirmed maze becomes the revert target; its recomputed path
      // drives the board.
      savedBlocksRef.current = blocks;
      setRun({ path: r.path, duration: r.duration, slows: r.slows });
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
