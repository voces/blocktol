import type { BlocktolApi } from "../common/api.ts";
import { noteFailure, noteSuccess } from "./store/connection.ts";
import { CLIENT_SHA, noteServerVersion } from "./store/version.ts";
import { Emitter, emitter } from "./util/emitter.ts";
import { getId } from "./util/id.ts";
import { allowReport } from "./util/reportGate.ts";

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

// Primed fetches: fired before the app renders (see index.ts) so the boot round
// trips overlap module evaluation and the first render. The next call with the
// SAME method + input consumes the in-flight response and continues through the
// normal handling below — by then listeners are subscribed, so the dispatched
// event isn't dropped. **Content-addressed** (method + serialized input), so a
// single bundled `boot` fetch can prime a parameterized method — e.g. `list` for
// a specific month — and only the call with matching input consumes that slice
// (the calendar's other months key separately and fetch on their own).
const primed = new Map<string, Promise<Response>>();

const primeKey = (method: string, input: unknown) =>
  `${method}:${JSON.stringify(input ?? null)}`;

// Set only for the synchronous extent of withKeepalive (below).
let keepalive = false;

const doFetch = (method: string, input: unknown) =>
  fetch(`/api/${method}`, {
    method: "POST",
    body: JSON.stringify(input),
    // x-blocktol-client-sha: this bundle's build, so the server logs the version
    // skew of who's calling it (beginLogger). The server answers with its own
    // build in x-blocktol-server-sha, which we read below to detect a stale tab.
    headers: { authorization: getId(), "x-blocktol-client-sha": CLIENT_SHA },
    keepalive,
  });

// Issue the api calls `fn` makes with `keepalive: true`, so they outlive the
// page being hidden or unloaded (the ranked saver's flush on pagehide). A call
// sends its first fetch synchronously, so a flag scoped to the synchronous
// call is enough — and deliberately doesn't reach a later retry, which only
// runs while the page is still alive anyway. (keepalive caps the body at 64KB;
// a maze is a few KB.)
export const withKeepalive = <T>(fn: () => T): T => {
  keepalive = true;
  try {
    return fn();
  } finally {
    keepalive = false;
  }
};

// Methods safe to auto-retry on a transport failure (fetch rejected, or a
// gateway/non-JSON response — see TransportError — so the request most likely
// never landed).
// Retrying is only sound when a repeat can't double-apply: reads (idempotent)
// and idempotent/last-write-wins writes. Deliberately EXCLUDED:
//   - updateRun   — runSaver.ts owns its own coalescing retry+backoff; a second
//                   layer here would fight it.
//   - startRun     — a run-lifecycle transition; a lost response after the
//                   server acted must not be silently redone.
//   - merge       — destructive, one-shot.
//   - deleteAccount — destructive lifecycle (id rotation); the client resets its
//                   local id on success, so a blind retry would act on the stale
//                   id. (The server op is itself an idempotent no-op on repeat.)
//   - reportClientError — retrying error reports risks amplifying a bad loop.
// setFlags IS retryable: it writes the whole flag set as an absolute value, so a
// repeat lands the same rows.
// commitRun IS retryable: free play's commit carries a per-attempt clientId and
// the server INSERT is guarded on it (NOT EXISTS), so a repeat is a no-op. Old
// clients' bare commit is an idempotent flip-to-non-void, also safe to repeat.
const RETRYABLE = new Set<keyof BlocktolApi>([
  "list",
  "dayView",
  "getBoard",
  "getDailySummary",
  "best",
  "standings",
  "getProfile",
  "moveInfo",
  "exportData",
  "getNotifications",
  "discordInfo",
  "pushConfig",
  "setSettings",
  "rename",
  "markNotificationsRead",
  "subscribePush",
  "unsubscribePush",
  "setRunPinned",
  "setFlags",
  "commitRun",
]);

// Backoff before each retry (ms); its length is the retry count. Jitter is added
// per attempt so a fleet reconnecting together doesn't synchronize its retries.
const RETRY_BACKOFF_MS = [400, 1_200, 3_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A response that is not the API answering. nginx in front of the co-located
// instance answers 502/503/504 with an HTML page while the upstream restarts
// (every deploy), and anything else that isn't JSON came from something other
// than our handler too. Either way the request most likely never reached the
// app, so it is a transport failure, not a server verdict: retryable methods
// retry it, and it feeds the connection tracker rather than the error channel.
export class TransportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const GATEWAY_STATUSES = new Set([502, 503, 504]);

const readJson = async (resp: Response) => {
  if (GATEWAY_STATUSES.has(resp.status)) {
    throw new TransportError(`gateway ${resp.status}`, resp.status);
  }
  try {
    return await resp.json();
  } catch {
    throw new TransportError(`non-JSON response (${resp.status})`, resp.status);
  }
};

// Fetch and decode a call, retrying transport failures for methods that are
// safe to repeat: fetch rejecting (no response at all) or a TransportError
// above. A JSON answer — error statuses included — is a real, deterministic
// server verdict and is returned as-is for the caller to handle. Non-retryable
// methods throw on the first transport failure.
const fetchJson = async (
  method: string,
  input: unknown,
): Promise<{ resp: Response; data: unknown }> => {
  const retries = RETRYABLE.has(method as keyof BlocktolApi)
    ? RETRY_BACKOFF_MS.length
    : 0;
  for (let attempt = 0;; attempt++) {
    try {
      const resp = await doFetch(method, input);
      return { resp, data: await readJson(resp) };
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
  primed.set(primeKey(method, input), p);
};

// Prime one method's next call from a slice of a *shared* composite response —
// the general form of what primeBoot does for boot. `source` is a composite
// fetch already in flight (e.g. `api.dayView(...)`), `pick` selects this
// method's slice, and it's stashed under the exact input the consumer will
// send. So a click that fires one `dayView` primes both the getBoard the
// board-loader sends AND the standings the dock reacts with, off the one
// request. If the source fails at transport (or comes back an auth error) the
// primed promise rejects and the consumer falls through to its own real fetch —
// a composite hiccup degrades to the old per-call path.
export const primeFrom = <Method extends keyof BlocktolApi, Source>(
  method: Method,
  input: Parameters<BlocktolApi[Method]>[0],
  source: Promise<Source>,
  pick: (data: Exclude<Source, { error: unknown }>) => unknown,
) => {
  const p = source.then((d) => {
    if (d && typeof d === "object" && "error" in d) {
      throw new Error(`prime source for ${String(method)} failed`);
    }
    return new Response(
      JSON.stringify(pick(d as Exclude<Source, { error: unknown }>)),
    );
  });
  p.catch(() => {});
  primed.set(primeKey(method, input), p);
};

// Prime the whole cold boot from ONE request. `boot` composes the handlers
// server-side; here each is primed with a promise that awaits that single fetch
// and hands back its slice as a synthetic Response — **content-keyed by the exact
// input the consumer sends** (see the table below), so every existing call site
// (App, the Dock, the Calendar, the stores) resolves off the one boot request
// with no change to those call sites.
//
// `listInputs` are the calendar's mount-month ranges, in the SAME order boot
// returns them ([current, prev]) — passed in from index.ts (the dailyItems store
// owns that range shape; taking it as a param avoids an api<->store import
// cycle). Each is primed under its own month key against boot's matching slice,
// so both calendar month fetches consume off the one request.
//
// If boot fails at transport (or returns a top-level auth error) each slice
// rejects, and the consumer's existing fall-through fetches that one method for
// real — a boot hiccup degrades to the old per-call path, not a broken boot.
export const primeBoot = (
  input: Parameters<BlocktolApi["boot"]>[0],
  listInputs: Parameters<BlocktolApi["list"]>[0][],
) => {
  const bootData = doFetch("boot", input).then((r) => r.json());
  bootData.catch(() => {});
  const tz = input.timeZone;
  // A synthetic Response for one slice of the boot bundle, chosen by `pick`.
  const slice = (pick: (b: MessageMap["boot"]) => unknown) => {
    const s = bootData.then((b) => {
      if (b && "error" in b) throw new Error("boot failed");
      return new Response(JSON.stringify(pick(b)));
    });
    s.catch(() => {});
    return s;
  };

  // [method, the input its boot-time consumer sends, slice picker]
  const single: [string, unknown, (b: MessageMap["boot"]) => unknown][] = [
    ["getDailySummary", { timeZone: tz }, (b) => b.summary],
    ["getProfile", {}, (b) => b.profile],
    ["standings", { timeZone: tz }, (b) => b.standings],
    ["getNotifications", {}, (b) => b.notifications],
    ["getBoard", { timeZone: tz }, (b) => b.board],
  ];
  for (const [method, consumerInput, pick] of single) {
    primed.set(primeKey(method, consumerInput), slice(pick));
  }
  // Each calendar month, keyed by its range, against boot.list[i].
  listInputs.forEach((li, i) => {
    primed.set(primeKey("list", li), slice((b) => b.list[i]));
  });

  // A `/YYYYMMDD` deep-link boot: `day` is set, so boot also carries the linked
  // day's slices (`b.linked`). Prime the three requests consumeDeepLink /
  // showBoard / the dock fire for that day, so it collapses onto this one boot
  // too. A slice that finds no linked day THROWS, so the consumer falls through
  // to its own real fetch (the deep-link handler already tolerates an
  // unresolvable date) — a linked miss degrades to the old per-call path.
  if (input.day) {
    const [ly, lm, ld] = input.day;
    const linkedSlice = (
      pick: (l: NonNullable<MessageMap["boot"]["linked"]>) => unknown,
    ) => {
      const s = bootData.then((b) => {
        if (b && "error" in b) throw new Error("boot failed");
        if (!b?.linked) throw new Error("boot: no linked day");
        return new Response(JSON.stringify(pick(b.linked)));
      });
      s.catch(() => {});
      return s;
    };
    // consumeDeepLink resolves the date first, via standings BY DATE.
    primed.set(
      primeKey("standings", { year: ly, month: lm, day: ld }),
      linkedSlice((l) => l.standings),
    );
    // The board (showBoard) and the dock's standings key off the ITERATION,
    // which is only known once boot lands — so set those primes then. They're
    // ready well before consumeDeepLink's multi-hop resolve→stage reaches them
    // (a miss just falls through to a real fetch, so ordering is not load-bearing).
    bootData.then((b) => {
      const linked = b?.linked;
      if (!linked || typeof linked.iteration !== "number") return;
      const it = linked.iteration;
      primed.set(
        primeKey("getBoard", { iteration: it, timeZone: tz }),
        Promise.resolve(new Response(JSON.stringify(linked.board))),
      );
      primed.set(
        primeKey("standings", { iteration: it }),
        Promise.resolve(new Response(JSON.stringify(linked.standings))),
      );
    }).catch(() => {});
  }

  // Returned so the caller can seed today's iteration id from the response (see
  // index.ts) — the standings dock needs it to recognize the staged board as
  // today and consume the primed { timeZone } slice rather than fetching by id.
  return bootData as Promise<MessageMap["boot"]>;
};

// Relay a failed request to the server's log. Through the shared report
// throttle (util/reportGate.ts), keyed per method + status: every error
// response used to fire its own report, so a polling or retrying caller hitting
// the same fault sent one per attempt — the amplification the global handlers'
// dedupe already prevented for crashes. And never a failed REPORT:
// reportClientError rides this same proxy, so during an outage every failed
// report would otherwise fire another — an unbounded loop hammering the server
// exactly when it's least healthy. Fire-and-forget; its own failure is
// swallowed so it can't surface as an unhandled rejection.
const reportFailedRequest = (
  method: string,
  status: number,
  error: unknown,
) => {
  if (method === "reportClientError") return;
  if (!allowReport(`Failed request: ${method} ${status}`)) return;
  api.reportClientError({
    message: "Failed request",
    data: { status, method, error },
  }).catch(() => {});
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
      const key = primeKey(method, input);
      const preloaded = primed.get(key);
      if (preloaded) primed.delete(key);
      let resp: Response;
      let data: unknown;
      try {
        // Consume the primed response if there is one; if that primed fetch
        // failed at the transport level, fall through to a fresh, retried fetch
        // rather than letting a boot-time network blip surface as a hard error.
        if (preloaded) {
          try {
            resp = await preloaded;
            data = await readJson(resp);
          } catch {
            ({ resp, data } = await fetchJson(method, input));
          }
        } else {
          ({ resp, data } = await fetchJson(method, input));
        }
      } catch (err) {
        // Transport-level failure that survived any retries (the server never
        // answered): feed the connection tracker, which surfaces the
        // Disconnected overlay once failures persist. A non-JSON body that is
        // NOT a gateway page is unexpected enough to report (a gateway page is
        // every deploy, and the server isn't there to hear about it).
        noteFailure();
        if (
          err instanceof TransportError && !GATEWAY_STATUSES.has(err.status)
        ) {
          reportFailedRequest(method, err.status, err.message);
        }
        throw err;
      }
      noteSuccess();
      // Note the server's build off the response header; a build newer than this
      // bundle marks the tab stale and schedules a reload at a safe moment (see
      // store/version.ts, useVersionRefresh). Synthetic primed responses carry no
      // header — a no-op.
      noteServerVersion(resp.headers.get("x-blocktol-server-sha"));
      if (data && typeof data === "object" && "error" in data) {
        reportFailedRequest(method, resp.status, data.error);
        em.dispatchEvent("error", { method, input, error: data });
      } else {
        // deno-lint-ignore no-explicit-any
        em.dispatchEvent(method, data as any);
      }
      return data;
    };
  },
}) as unknown as Emitter<MessageMap> & BlocktolApi;
