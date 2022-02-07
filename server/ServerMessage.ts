import type { StartMessage } from "../common/serverToClientMessage.ts";

// Leadership election
type ElectionMessage = Readonly<{ kind: "election"; value: number }>;
type HeartbeatMessage = Readonly<{ kind: "heartbeat" }>;
type VetoMessage = Readonly<{ kind: "veto" }>;

export type StartRunMessage = Readonly<
  { kind: "startRun"; times: number[] }
>;
export type PlayerRunsMessage = Readonly<{
  kind: "playerRuns";
  playerRuns: {
    player: string;
    rating: number;
    duration: number;
  }[];
}>;

export type ServerMessage =
  | ElectionMessage
  | HeartbeatMessage
  | VetoMessage
  | StartMessage
  | StartRunMessage
  | PlayerRunsMessage;

export { StartMessage };
