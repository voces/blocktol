import { arrayOf, has, hasEnum, hasNumber, isPoint } from "./typeguards.ts";
import { isRecord } from "./typeguards.ts";
import { Point } from "./types.ts";

export type StartMessage = Readonly<{
  kind: "start";
  time: number;
  checkpoint: Point;
  thunders: Point[];
  blocks: Point[];
  power: number;
  bricks: number;
  minTime: number;
}>;

const isStartMessage = (value: unknown): value is StartMessage =>
  isRecord(value) &&
  hasEnum(value, "kind", ["start"]) &&
  has(value, "checkpoint", isPoint) &&
  has(value, "thunders", arrayOf(isPoint)) &&
  has(value, "blocks", arrayOf(isPoint)) &&
  hasNumber(value, "power") &&
  hasNumber(value, "bricks");

export type RunMessage = Readonly<{
  kind: "run";
  path: Point[];
  duration: number;
  slows: number[];
  rating: number;
}>;

const isRunMessage = (value: unknown): value is StartMessage =>
  isRecord(value) &&
  hasEnum(value, "kind", ["run"]) &&
  has(value, "path", arrayOf(isPoint)) &&
  hasNumber(value, "duration");

export type MessageMap = {
  start: StartMessage;
  run: RunMessage;
  disconnect: never;
  connect: never;
};

export type Message = MessageMap[keyof MessageMap];

export const isMessage = (value: unknown): value is Message =>
  isStartMessage(value) || isRunMessage(value);
