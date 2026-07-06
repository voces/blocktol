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
      setCheckpoint(data.checkpoint);
      setBlocks(data.blocks.map((b) => b.player ? { ...b, local: true } : b));
      setBricks(data.bricks);
      setPower(data.power);
      setTime(Math.floor(data.remainingTime));
      setDate(new Date(data.date).getTime());
      setIteration(data.iteration);

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
      setCheckpoint(data.checkpoint);
      // A staged board is the iteration's fixed pieces only — no player blocks
      // exist until the first placement opens the run.
      setBlocks(data.blocks.map((b) => ({ ...b })));
      setBricks(data.bricks);
      setPower(data.power);
      setTime(60);
      setDate(new Date(data.date).getTime());
      setIteration(data.iteration);
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      setTransitionBlock(undefined);
      setThunderHover(undefined);

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
      if (freePlay) {
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

    game.dispatchEvent("runStart", run);

    setPlacingBlock((pb) => ({ ...pb, placing: false }));
    setTransitionBlock(undefined);
    setTime(-1);
    // Leave bricks/power as they were — the HUD keeps showing the leftover
    // counts through the run animation rather than blanking them out. The next
    // board (startRun / getBoard) resets them for the following build.
    setTouching(false);
    setThunderHover(undefined);
  }, [time, run]);

  useApiListener(
    "updateRun",
    (e) => setRun({ path: e.path, duration: e.duration, slows: e.slows }),
  );
};
