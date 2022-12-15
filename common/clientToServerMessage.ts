import { GuardedType, is } from "./typeguards.ts";

const isLoginMessage = is.object({
  kind: is.const("login"),
  username: is.union(is.string, is.undefined),
  id: is.string,
  timeZone: is.string,
});
export type LoginMessage = GuardedType<typeof isLoginMessage>;

const isBlockMessage = is.object({
  kind: is.const("block"),
  x: is.number,
  y: is.number,
});
export type BlockMessage = GuardedType<typeof isBlockMessage>;

const isTransitionBlockMessage = is.object({
  kind: is.const("transition"),
  x: is.number,
  y: is.number,
});
export type TransitionBlockMessage = GuardedType<
  typeof isTransitionBlockMessage
>;

const isListMessage = is.object({ kind: is.const("list") });
export type ListMessage = GuardedType<typeof isListMessage>;

const isPlayMessage = is.object({
  kind: is.const("play"),
  iteration: is.union(is.number, is.undefined),
});
export type PlayMessage = GuardedType<typeof isPlayMessage>;

const isReadyMessage = is.object({
  kind: is.const("ready"),
});
export type ReadyMessage = GuardedType<typeof isReadyMessage>;

export const isMessage = is.union(
  isLoginMessage,
  isBlockMessage,
  isTransitionBlockMessage,
  isListMessage,
  isPlayMessage,
  isReadyMessage,
);
export type ClientToServerMessage = GuardedType<typeof isMessage>;
