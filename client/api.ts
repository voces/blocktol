import type { BlocktolApi } from "../common/api.ts";
import { Emitter, emitter } from "./util/emitter.ts";
import { getId } from "./util/id.ts";

export type MessageMap = {
  [Method in keyof BlocktolApi]: Exclude<
    Awaited<ReturnType<BlocktolApi[Method]>>,
    Extract<
      Awaited<ReturnType<BlocktolApi[Method]>>,
      // deno-lint-ignore no-explicit-any
      { error: any }
    >
  >;
};

const host = {};
const em = emitter<typeof host, MessageMap>(host);

export const api = new Proxy({}, {
  get<
    Method extends
      | keyof BlocktolApi
      | "addEventListener"
      | "removeEventListener",
  >(_: unknown, method: Method) {
    if (typeof method !== "string") {
      throw new Error("Expected method to be a string");
    }

    if (method === "addEventListener") return em.addEventListener;
    if (method === "removeEventListener") return em.removeEventListener;

    return async (input: Parameters<BlocktolApi[keyof BlocktolApi]>) => {
      const resp = await fetch(`/api/${method}`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { authorization: getId() },
      });
      const data = await resp.json();
      if (!("error" in data)) em.dispatchEvent(method, data);
      return data;
    };
  },
}) as unknown as Emitter<MessageMap> & BlocktolApi;
