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

// Primed fetches: fired before the app renders (see index.ts) so the boot
// round trips overlap module evaluation and the first render. The next call
// of the same method consumes the in-flight response and continues through
// the normal handling below — by then listeners are subscribed, so the
// dispatched event isn't dropped. Keyed by method only: priming is a boot
// concern, and the boot call repeats the same input.
const primed = new Map<string, Promise<Response>>();

export const prime = <Method extends keyof BlocktolApi>(
  method: Method,
  input: Parameters<BlocktolApi[Method]>[0],
) => {
  const p = fetch(`/api/${method}`, {
    method: "POST",
    body: JSON.stringify(input),
    headers: { authorization: getId() },
  });
  // Observed so an early failure can't surface as an unhandled rejection;
  // the consuming call still sees it (and handles it like its own fetch).
  p.catch(() => {});
  primed.set(method, p);
};

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
      const preloaded = primed.get(method);
      if (preloaded) primed.delete(method);
      const resp = await (preloaded ?? fetch(`/api/${method}`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { authorization: getId() },
      }));
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
