import { hasEnum, hasString } from "./typeguards.ts";
import { isRecord } from "./typeguards.ts";

export type LoginMessage = {
  kind: "login";
  username: string;
  id: string;
};

const isLoginMessage = (value: unknown): value is LoginMessage =>
  isRecord(value) &&
  hasEnum(value, "kind", ["login"]) &&
  hasString(value, "username") &&
  hasString(value, "id");

type Message = LoginMessage;

export const isMessage = (value: unknown): value is Message =>
  isLoginMessage(value);
