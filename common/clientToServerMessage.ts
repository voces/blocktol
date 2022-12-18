import { GuardedType, is, isPoint } from "./typeguards.ts";

const isLoginMessage = is.object({
  kind: is.const("login"),
  username: is.union(is.string, is.undefined),
  id: is.string,
  timeZone: is.string,
});
export type LoginMessage = GuardedType<typeof isLoginMessage>;

const isBlockMessage = is.intersection(
  is.object({ kind: is.const("block") }),
  isPoint,
);
export type BlockMessage = GuardedType<typeof isBlockMessage>;

const isTransitionBlockMessage = is.intersection(
  is.object({ kind: is.const("transition") }),
  isPoint,
);
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
