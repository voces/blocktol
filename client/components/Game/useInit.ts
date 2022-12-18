import { useContext, useEffect } from "preact/compat";
import { offsets } from "../../../common/constants.ts";
import { newGrid } from "../../../common/pathing.ts";
import {
  DailyMessage,
  RunMessage,
  StartMessage,
} from "../../../common/serverToClientMessage.ts";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { GameStateContext } from "./useGameState.ts";

export const useInit = () => {
  const connection = useContext(ConnectionContext);
  const {
    setTime,
    setPlacingBlock,
    grid,
    setInvalid,
    setThunderHover,
    setTransitionBlock,
    setTouching,
    setBlocks,
    setThunders,
    setPower,
    setBricks,
    setRun,
    setCheckpoint,
    setRating,
    setDisconnected,
    setLastRating,
    rating: lastRating,
    setDate,
    setAttempts,
  } = useContext(GameStateContext);

  useEffect(() => {
    const startCallback = (
      { checkpoint, blocks, thunders, ...event }: StartMessage,
    ) => {
      setRun(undefined);
      setLastRating(NaN);
      setCheckpoint(checkpoint);
      setThunders(
        thunders.map(({ x, y, player }) => ({ x, y, local: player })),
      );
      setBlocks(blocks.map(({ x, y, player }) => ({ x, y, local: player })));
      setBricks(event.bricks);
      setPower(event.power);
      setTime(Math.floor(event.time));
      setRating(event.rating);
      setDate(event.date);

      grid.splice(0, Infinity, ...newGrid());

      grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
      for (const { x, y } of thunders) {
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
      }
      for (const { x, y } of blocks) {
        offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
      }
    };
    connection.addEventListener("start", startCallback);

    const disconnectCallback = () => {
      setDisconnected(true);
      setTime(-1);
    };
    connection.addEventListener("disconnect", disconnectCallback);

    const connectCallback = () => {
      setDisconnected(false);
      setCheckpoint({ x: -2, y: -2 });
      setBlocks([]);
      setThunders([]);
      setBricks(-1);
      setPower(-1);
      setRun(undefined);
      setInvalid(false);
      setTransitionBlock(undefined);
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
    };
    connection.addEventListener("connect", connectCallback);

    const dailyCallback = ({ attempts, rating }: DailyMessage) => {
      setAttempts(attempts);
      setRating(rating);
    };
    connection.addEventListener("daily", dailyCallback);

    return () => {
      connection.removeEventListener("start", startCallback);
      connection.removeEventListener("disconnect", disconnectCallback);
      connection.removeEventListener("connect", connectCallback);
      connection.removeEventListener("daily", dailyCallback);
    };
  }, [connection]);

  useEffect(() => {
    const runCallback = ({ path, duration, slows, rating }: RunMessage) => {
      setRun({ path, duration, slows });
      setPlacingBlock((pb) => ({ ...pb, placing: false }));
      setTransitionBlock(undefined);
      setTime(-1);
      setBricks(-1);
      setPower(-1);
      setTouching(false);
      setThunderHover(undefined);
      setLastRating(lastRating);
      setRating(rating);
    };
    connection.addEventListener("run", runCallback);

    return () => connection.removeEventListener("run", runCallback);
  }, [connection, lastRating]);
};
