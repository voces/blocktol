import { useCallback, useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { newGrid } from "../../../common/pathing.ts";
import { api, MessageMap } from "../../api.ts";
import { Point } from "../../../common/types.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { useGame, useGameListener } from "../../hooks/useGame.ts";
import { getTimeZone } from "../../util/timeZone.ts";
import { GameStateContext } from "./useGameState.ts";

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
    clear,
    blocks,
    checkpoint,
    iteration,
    setIteration,
    setStaged,
    freePlay,
    setFreePlay,
  } = useContext(GameStateContext);

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
      setCheckpoint(data.checkpoint);
      setBlocks(data.blocks.map((b) => b.player ? { ...b, local: true } : b));
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

  useApiListener("startRun", handleRun);
  useApiListener("getBoard", handleStaged);
  useApiListener(
    "getDailySummary",
    ({ attempts, currentRun }) => {
      if (currentRun && time === -2) {
        setAttemptsRemaining(3 - attempts.length + 1);
        return handleRun(currentRun);
      }

      if (attempts.length === 3) {
        setAttemptsRemaining(0);
        return setAttempts(attempts);
      }

      setAttemptsRemaining(3 - attempts.length);
    },
  );

  useGameListener(
    "runFinish",
    () => {
      if (iteration === undefined) return;
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

  useApiListener("best", ({ maze }) => {
    clear();
    setBlocks([
      ...blocks.filter((b) => !b.local),
      ...maze.map((b) => ({ ...b, local: true })),
    ]);
    setCheckpoint(checkpoint);
  }, [blocks, checkpoint]);

  useEffect(() => {
    if (time !== 0 || !run) return;

    game.dispatchEvent("runStart", run);

    setPlacingBlock((pb) => ({ ...pb, placing: false }));
    setTransitionBlock(undefined);
    setTime(-1);
    setBricks(-1);
    setPower(-1);
    setTouching(false);
    setThunderHover(undefined);
  }, [time, run]);

  useApiListener(
    "updateRun",
    (e) => setRun({ path: e.path, duration: e.duration, slows: e.slows }),
  );
};
