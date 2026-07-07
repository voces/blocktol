import { useCallback, useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { newGrid } from "../../../common/pathing.ts";
import { api, MessageMap } from "../../api.ts";
import { Point } from "../../../common/types.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { useDailyItems } from "../../hooks/useDailyItems.tsx";
import { useGame, useGameListener } from "../../hooks/useGame.ts";
import { getTimeZone } from "../../util/timeZone.ts";
import { GameStateContext } from "./useGameState.ts";
import { computeVerdict } from "./verdict.ts";

export const useInit = () => {
  const game = useGame();
  const { applyRun } = useDailyItems();
  const {
    setTime,
    setPlacingBlock,
    grid,
    setThunderHover,
    setTransitionBlock,
    setTouching,
    setBlocks,
    setPower,
    setBricks,
    setBricksTotal,
    setPowerTotal,
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
    viewMaze,
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
      setBricks(data.bricks);
      setPower(data.power);
      // Full budget = what's left plus what's already been placed this run, so a
      // resumed run still recovers the true total (for the review leftover chips).
      setBricksTotal(data.bricks + data.blocks.filter((b) => b.player).length);
      setPowerTotal(
        data.power + data.blocks.filter((b) => b.player && b.thunder).length,
      );
      setTime(Math.floor(data.remainingTime));
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
  const handleStaged = useCallback(
    (data: MessageMap["getBoard"]) => {
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
      setBricks(data.bricks);
      setPower(data.power);
      // A staged board has no player blocks yet, so its budget is the full total.
      setBricksTotal(data.bricks);
      setPowerTotal(data.power);
      setTime(60);
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

  useApiListener("startRun", (e) => {
    handleRun(e);
    setViewedAttempts(e.attempts);
  });
  useApiListener("getBoard", (e) => {
    handleStaged(e);
    setViewedAttempts(e.attempts);
  });
  useApiListener(
    "getDailySummary",
    ({ attempts, ranked, currentRun }) => {
      // `attempts` is the full list (panel); `ranked` (first three) drives the
      // result modal and the attempts-remaining count.
      setViewedAttempts(attempts);

      if (currentRun && time === -2) {
        setAttemptsRemaining(3 - ranked.length + 1);
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
      // The calendar / today panels update locally from the fresh attempts (see
      // the applyRun effect above) — no list refetch here.
      // Free play never spends a ranked attempt — it just re-stages the board.
      // The milestone celebration (if any) fired at commit, not here; clear it
      // as the board re-stages.
      if (freePlay) {
        setVerdict(undefined);
        api.getBoard({ iteration, timeZone: getTimeZone() });
        return;
      }
      setAttemptsRemaining((a) => Math.max(a - 1, 0));
      if (attemptsRemaining === 1) api.getDailySummary({ iteration });
      else api.startRun({ iteration, timeZone: getTimeZone() });
    },
    [iteration, attemptsRemaining, freePlay],
  );

  useApiListener("best", ({ maze }) => viewMaze(maze));

  useEffect(() => {
    if (time !== 0 || !run) return;

    // The run is now executing (the clock hit 0, or the player tapped start / R).
    // A free-play run counts only from this point — commit it non-void so it
    // lands in the panel and best; leaving before now kept it void (abandoned).
    // A daily attempt is already committed on build, so it's left alone.
    if (freePlay && iteration !== undefined) {
      const maze = blocks.filter((b) => b.local).map((b) =>
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
        const denom = fieldBest - min;
        const scored = (d: number) =>
          denom > 0 ? Math.max(0, Math.min(1, (d - min) / denom)) : 1;
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

  useApiListener(
    "updateRun",
    (e) => setRun({ path: e.path, duration: e.duration, slows: e.slows }),
  );
};
