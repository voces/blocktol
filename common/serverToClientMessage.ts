import { GuardedType, is, isPoint } from "./typeguards.ts";

const isStartMessage = is.object({
  kind: is.const("start"),
  date: is.number,
  time: is.number,
  checkpoint: isPoint,
  thunders: is.array(isPoint),
  blocks: is.array(isPoint),
  power: is.number,
  bricks: is.number,
  minTime: is.number,
  rating: is.number,
  attempts: is.number,
});
export type StartMessage = GuardedType<typeof isStartMessage>;

const isRunMessage = is.object({
  kind: is.const("run"),
  path: is.array(isPoint),
  duration: is.number,
  percentile: is.union(is.number, is.null),
  slows: is.array(is.object({ time: is.number, thunder: isPoint })),
  rating: is.number,
});
export type RunMessage = Readonly<GuardedType<typeof isRunMessage>>;

const isLogMessage = is.object({
  kind: is.const("log"),
  source: is.string,
  time: is.number,
  message: is.string,
});
export type LogMessage = GuardedType<typeof isLogMessage>;

const isDailyMessage = is.object({
  kind: is.const("daily"),
  attempts: is.array(is.object({ duration: is.number, percentile: is.number })),
});
export type DailyMessage = GuardedType<typeof isDailyMessage>;
export type MessageMap = {
  start: StartMessage;
  run: RunMessage;
  log: LogMessage;
  daily: DailyMessage;
  disconnect: never;
  connect: never;
};

export type Message = MessageMap[keyof MessageMap];

export const isMessage = (value: unknown): value is Message =>
  isStartMessage(value) || isRunMessage(value) || isLogMessage(value) ||
  isDailyMessage(value);
