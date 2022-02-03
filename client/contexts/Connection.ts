import { createContext } from "preact";
import { ClientToServerMessage } from "../../common/clientToServerMessage.ts";
import { isMessage, MessageMap } from "../../common/serverToClientMessage.ts";
import { Emitter, emitter } from "../util/emitter.ts";

class Connection implements Emitter<MessageMap> {
  #ws!: WebSocket;

  declare addEventListener: Emitter<MessageMap>["addEventListener"];
  declare removeEventListener: Emitter<MessageMap>["removeEventListener"];
  declare removeEventListeners: Emitter<MessageMap>["removeEventListeners"];
  declare dispatchEvent: Emitter<MessageMap>["dispatchEvent"];

  constructor() {
    this.#setupSocket();

    emitter(this);
  }

  #setupSocket() {
    const protocol = location.protocol === "http:" ? "ws" : "wss";
    this.#ws = new WebSocket(`${protocol}://${location.hostname}:3000`);

    this.#ws.addEventListener("open", () => {
      this.dispatchEvent("connect", undefined as never);
    });

    this.#ws.addEventListener("message", (e) => {
      try {
        const json = JSON.parse(e.data);
        if (isMessage(json)) this.dispatchEvent(json.kind, json);
        else console.error("Received invalid message", json);
      } catch {
        console.error("Received invalid JSON", e.data);
      }
    });

    this.#ws.addEventListener("close", () => {
      console.log("Disconnected, reconnecting...");
      this.#setupSocket();
      this.dispatchEvent("disconnect", undefined as never);
    });
  }

  send(value: ClientToServerMessage) {
    this.#ws.send(JSON.stringify(value));
  }

  get connected() {
    return this.#ws.readyState === WebSocket.OPEN;
  }
}

export const ConnectionContext = createContext(new Connection());
