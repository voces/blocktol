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

const isChatMessage = is.object({
  kind: is.const("chat"),
  message: is.string,
});
export type ChatMessage = GuardedType<typeof isChatMessage>;

export const isMessage = is.union(
  isLoginMessage,
  isBlockMessage,
  isTransitionBlockMessage,
  isChatMessage,
);
export type ClientToServerMessage = GuardedType<typeof isMessage>;
