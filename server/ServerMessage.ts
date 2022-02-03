import type { StartMessage } from "../common/serverToClientMessage.ts";

// Leadership election
type ElectionMessage = Readonly<{ kind: "election"; value: number }>;
type HeartbeatMessage = Readonly<{ kind: "heartbeat" }>;
type VetoMessage = Readonly<{ kind: "veto" }>;

export type StartRunMessage = Readonly<{ kind: "startRun"; max: number }>;
export type RunBeatMessage = Readonly<{ kind: "runBeat"; max: number }>;

export type ServerMessage =
  | ElectionMessage
  | HeartbeatMessage
  | VetoMessage
  | StartMessage
  | StartRunMessage
  | RunBeatMessage;

export { StartMessage };
