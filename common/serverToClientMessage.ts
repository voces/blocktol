import { GuardedType, is, isPoint } from "./typeguards.ts";

const isStartMessage = is.object({
  kind: is.const("start"),
  time: is.number,
  checkpoint: isPoint,
  thunders: is.array(isPoint),
  blocks: is.array(isPoint),
  power: is.number,
  bricks: is.number,
  minTime: is.number,
  rating: is.number,
});
export type StartMessage = GuardedType<typeof isStartMessage>;

const isRunMessage = is.object({
  kind: is.const("run"),
  path: is.array(isPoint),
  duration: is.number,
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

export type MessageMap = {
  start: StartMessage;
  run: RunMessage;
  log: LogMessage;
  disconnect: never;
  connect: never;
};

export type Message = MessageMap[keyof MessageMap];

export const isMessage = (value: unknown): value is Message =>
  isStartMessage(value) || isRunMessage(value) || isLogMessage(value);
