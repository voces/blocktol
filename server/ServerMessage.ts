import type { StartMessage } from "../common/serverToClientMessage.ts";

// Leadership election
type ElectionMessage = Readonly<{ kind: "election"; value: number }>;
type HeartbeatMessage = Readonly<{ kind: "heartbeat" }>;
type VetoMessage = Readonly<{ kind: "veto" }>;

export type ServerMessage =
  | ElectionMessage
  | HeartbeatMessage
  | VetoMessage
  | StartMessage;
export { StartMessage };
