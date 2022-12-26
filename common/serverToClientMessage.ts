import { GuardedType, is, isPoint } from "./typeguards.ts";

const isPlayerPoint = is.intersection(
  isPoint,
  is.object({ player: is.union(is.boolean, is.undefined) }),
);

const isStartMessage = is.object({
  kind: is.const("start"),
  iteration: is.number,
  date: is.number,
  time: is.number,
  checkpoint: isPoint,
  thunders: is.array(isPlayerPoint),
  blocks: is.array(isPlayerPoint),
  power: is.number,
  bricks: is.number,
  rating: is.number,
  todaysRemainingDailyAttempts: is.number,
  ownBest: is.union(is.number, is.null),
});
export type StartMessage = GuardedType<typeof isStartMessage>;

const isRunMessage = is.object({
  kind: is.const("run"),
  iteration: is.number,
  path: is.array(isPoint),
  duration: is.number,
  percentile: is.union(is.number, is.undefined),
  percent: is.number,
  slows: is.array(is.object({ time: is.number, thunder: isPoint })),
  rating: is.number,
});
export type RunMessage = Readonly<GuardedType<typeof isRunMessage>>;

const isDailyMessage = is.object({
  kind: is.const("daily"),
  rating: is.number,
  attempts: is.array(
    is.object({
      duration: is.number,
      percentile: is.union(is.number, is.null),
    }),
  ),
});
export type DailyMessage = GuardedType<typeof isDailyMessage>;

const isListMessage = is.object({
  kind: is.const("list"),
  items: is.array(
    is.object({
      iteration: is.number,
      daily: is.tuple(is.number, is.number, is.number),
      ownDailyBest: is.union(is.number, is.null),
      ownBest: is.union(is.number, is.null),
      best: is.union(is.number, is.null),
    }),
  ),
});
export type ListMessage = GuardedType<typeof isListMessage>;

export type MessageMap = {
  start: StartMessage;
  run: RunMessage;
  daily: DailyMessage;
  disconnect: never;
  connect: never;
  list: ListMessage;
};

export type Message = MessageMap[keyof MessageMap];

export const isMessage = (value: unknown): value is Message =>
  isStartMessage(value) || isRunMessage(value) || isDailyMessage(value) ||
  isListMessage(value);
