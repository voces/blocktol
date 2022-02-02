export type NewNodeMessage = Readonly<{ kind: "newNode" }>;
export type RootIdentifyMessage = Readonly<{ kind: "root" }>;

export type ServerMessage = NewNodeMessage | RootIdentifyMessage;
