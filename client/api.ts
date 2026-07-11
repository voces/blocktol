import type { BlocktolApi } from "../common/api.ts";
import { noteFailure, noteSuccess } from "./store/connection.ts";
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

const doFetch = (method: string, input: unknown) =>
  fetch(`/api/${method}`, {
    method: "POST",
    body: JSON.stringify(input),
    headers: { authorization: getId() },
  });

// Methods safe to auto-retry on a transport failure (fetch rejected — the
// server never sent a response, so the request most likely never landed).
// Retrying is only sound when a repeat can't double-apply: reads (idempotent)
// and idempotent/last-write-wins writes. Deliberately EXCLUDED:
//   - updateRun   — runSaver.ts owns its own coalescing retry+backoff; a second
//                   layer here would fight it.
//   - startRun / commitRun / abandonRun — run-lifecycle transitions; a lost
//                   response after the server acted must not be silently redone.
//   - merge       — destructive, one-shot.
//   - reportClientError — retrying error reports risks amplifying a bad loop.
const RETRYABLE = new Set<keyof BlocktolApi>([
  "list",
  "getBoard",
  "getDailySummary",
  "best",
  "standings",
  "getProfile",
  "moveInfo",
  "getNotifications",
  "discordInfo",
  "pushConfig",
  "setSettings",
  "rename",
  "markNotificationsRead",
  "subscribePush",
  "unsubscribePush",
]);

// Backoff before each retry (ms); its length is the retry count. Jitter is added
// per attempt so a fleet reconnecting together doesn't synchronize its retries.
const RETRY_BACKOFF_MS = [400, 1_200, 3_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resolve the Response for a call, retrying transport failures for methods that
// are safe to repeat. A retry fires ONLY when fetch itself rejects (no response
// at all); an HTTP error status is a real, deterministic server answer and is
// returned as-is for the caller to handle. Non-retryable methods throw on the
// first transport failure, exactly as before.
const fetchResponse = async (
  method: string,
  input: unknown,
): Promise<Response> => {
  const retries = RETRYABLE.has(method as keyof BlocktolApi)
    ? RETRY_BACKOFF_MS.length
    : 0;
  for (let attempt = 0;; attempt++) {
    try {
      return await doFetch(method, input);
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(RETRY_BACKOFF_MS[attempt] + Math.random() * 250);
    }
  }
};

export const prime = <Method extends keyof BlocktolApi>(
  method: Method,
  input: Parameters<BlocktolApi[Method]>[0],
) => {
  const p = doFetch(method, input);
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
      let resp: Response;
      try {
        // Consume the primed response if there is one; if that primed fetch
        // failed at the transport level, fall through to a fresh, retried fetch
        // rather than letting a boot-time network blip surface as a hard error.
        if (preloaded) {
          try {
            resp = await preloaded;
          } catch {
            resp = await fetchResponse(method, input);
          }
        } else {
          resp = await fetchResponse(method, input);
        }
      } catch (err) {
        // Transport-level failure that survived any retries (the server never
        // responded): feed the connection tracker, which surfaces the
        // Disconnected overlay once failures persist.
        noteFailure();
        throw err;
      }
      noteSuccess();
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
