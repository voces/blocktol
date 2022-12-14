import { createContext } from "preact";
import { ClientToServerMessage } from "../../common/clientToServerMessage.ts";
import { isMessage, MessageMap } from "../../common/serverToClientMessage.ts";
import { Emitter, emitter } from "../util/emitter.ts";

class Connection implements Emitter<MessageMap> {
  #ws!: WebSocket;
  #lastDisconnect: number | undefined;
  #openValue: number | undefined;

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
    this.#ws = new WebSocket(`${protocol}://${location.host}`);

    this.#ws.addEventListener("open", () => {
      this.dispatchEvent("connect", undefined as never);

      const openValue = this.#openValue = Math.random();
      setTimeout(() => {
        if (openValue === this.#openValue) this.#lastDisconnect = undefined;
      }, 250);
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
      this.dispatchEvent("disconnect", undefined as never);

      this.#openValue = undefined;
      const now = Date.now();
      const timeout = Math.min(
        10_000,
        now - (this.#lastDisconnect ?? now + 900) + 1_000,
      );
      this.#lastDisconnect = now;
      setTimeout(() => this.#setupSocket(), timeout);
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
