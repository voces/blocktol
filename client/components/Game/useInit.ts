import { useCallback, useContext, useEffect, useState } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { newGrid } from "../../../common/pathing.ts";
import { api, MessageMap } from "../../api.ts";
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
    setInvalid,
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
  } = useContext(GameStateContext);
  const [iteration, setIteration] = useState(0);

  const handleRun = useCallback(
    (data: NonNullable<MessageMap["getDailySummary"]["currentRun"]>) => {
      setRun({ path: data.path, duration: data.duration, slows: data.slows });
      setCheckpoint(data.checkpoint);
      setBlocks(data.blocks.map((b) => b.player ? { ...b, local: true } : b));
      setBricks(data.bricks);
      setPower(data.power);
      setTime(Math.floor(data.remainingTime));
      setDate(new Date(data.date).getTime());
      setIteration(data.iteration);

      grid.splice(0, Infinity, ...newGrid());
      grid[data.checkpoint.y + 0.5][data.checkpoint.x + 0.5] = true;
      for (const { x, y } of data.blocks) {
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
      }
    },
    [],
  );

  useApiListener("startRun", handleRun);
  useApiListener(
    "getDailySummary",
    ({ attempts, currentRun }) => {
      if (currentRun) handleRun(currentRun);
      if (attempts.length === 3) setAttempts(attempts);
      setAttemptsRemaining(3 - Math.min(attempts.length, 3));
    },
  );

  useGameListener(
    "runFinish",
    () => {
      setAttemptsRemaining((a) => Math.max(a - 1, 0));
      if (attemptsRemaining < 1) {
        api.startRun({ iteration, timeZone: getTimeZone() });
      } else {
        api.getDailySummary({ iteration });
      }
    },
    [iteration, attemptsRemaining],
  );

  useApiListener("best", ({ maze }) => {
    setBlocks((oldBlocks) => [
      ...oldBlocks.filter((b) => !b.local),
      ...maze.filter((b) => !b.thunder).map((b) => ({ ...b, local: true })),
    ]);
    setBricks(-1);
    setPower(-1);
    setRun(undefined);
    setInvalid(false);
    setTransitionBlock(undefined);
    setPlacingBlock((pb) => ({ ...pb, placing: false }));
    setTime(-1);
  });

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
