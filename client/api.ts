import type { BlocktolApi } from "../common/api.ts";
import { Emitter, emitter } from "./util/emitter.ts";
import { getId } from "./util/id.ts";

export type MessageMap =
  & {
    [Method in keyof BlocktolApi]: Exclude<
      Awaited<ReturnType<BlocktolApi[Method]>>,
      Extract<
        Awaited<ReturnType<BlocktolApi[Method]>>,
        // deno-lint-ignore no-explicit-any
        { error: any }
      >
    >;
  }
  & {
    error: { method: keyof BlocktolApi; input: unknown; error: unknown };
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
      try {
        const data = await resp.json();
        if (!("error" in data)) em.dispatchEvent(method, data);
        else {
          // Never report a failed report: reportClientError rides this same
          // proxy, so during an outage every failed report would otherwise fire
          // another — an unbounded loop hammering the server exactly when it's
          // least healthy.
          if (method !== "reportClientError") {
            // Fire-and-forget; swallow its own failure (e.g. network down) so
            // it doesn't surface as an unhandled rejection.
            api.reportClientError({
              message: "Failed request",
              data: { status: resp.status, method, error: data.error },
            }).catch(() => {});
          }
          em.dispatchEvent("error", { method, input, error: data });
        }
        return data;
      } catch (err) {
        if (method !== "reportClientError") {
          api.reportClientError({
            message: "Failed request",
            data: {
              status: resp.status,
              method,
              error: err instanceof Error ? err.message : String(err),
            },
          }).catch(() => {});
        }
        throw err;
      }
    };
  },
}) as unknown as Emitter<MessageMap> & BlocktolApi;
