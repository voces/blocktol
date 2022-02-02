import { hasEnum, hasNumber, hasString } from "./typeguards.ts";
import { isRecord } from "./typeguards.ts";

export type LoginMessage = {
  kind: "login";
  username: string;
  id: string;
};

export type BlockMessage = {
  kind: "block";
  x: number;
  y: number;
};

const isLoginMessage = (value: unknown): value is LoginMessage =>
  isRecord(value) &&
  hasEnum(value, "kind", ["login"]) &&
  hasString(value, "username") &&
  hasString(value, "id");

const isBlockMessage = (value: unknown): value is LoginMessage =>
  isRecord(value) &&
  hasEnum(value, "kind", ["block"]) &&
  hasNumber(value, "x") &&
  hasNumber(value, "y");

export type ClientToServerMessage = LoginMessage | BlockMessage;

export const isMessage = (value: unknown): value is ClientToServerMessage =>
  isLoginMessage(value) || isBlockMessage(value);
