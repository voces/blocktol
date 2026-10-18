import type { BlocktolApi } from "../common/api.ts";
import { noteFailure, noteSuccess } from "./store/connection.ts";
import { CLIENT_SHA, noteServerVersion } from "./store/version.ts";
import { Emitter, emitter } from "./util/emitter.ts";
import { getId } from "./util/id.ts";
import { primePool } from "./util/primePool.ts";
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
// normal handling below, by which time listeners are subscribed. Keys are
// content-addressed (method + serialized input), so one bundled `boot` fetch
// can prime a parameterized method such as `list` for a given month.
//
// A prime lives PRIME_TTL_MS, then is dropped unconsumed: an unconsumed one
// would otherwise answer a refresh minutes later with a snapshot from before
// the player's latest run. The window restarts when the response arrives, so a
// slow boot doesn't expire primes. A late consumer just fetches for real.
const PRIME_TTL_MS = 10_000;
const primed = primePool<Promise<Response>>(PRIME_TTL_MS);

const setPrime = (key: string, p: Promise<Response>) => {
  primed.set(key, p);
  p.then(() => primed.touch(key, p), () => {});
};

const primeKey = (method: string, input: unknown) =>
  `${method}:${JSON.stringify(input ?? null)}`;

// Set only for the synchronous extent of withKeepalive (below).
let keepalive = false;

const doFetch = (method: string, input: unknown) =>
  fetch(`/api/${method}`, {
    method: "POST",
    body: JSON.stringify(input),
    // x-blocktol-client-sha: this bundle's build, so the server logs the
    // version skew of who's calling it (beginLogger). The server answers with
    // its own build in x-blocktol-server-sha, which we read below to detect a
    // stale tab.
    headers: { authorization: getId(), "x-blocktol-client-sha": CLIENT_SHA },
    keepalive,
  });

// Issue the api calls `fn` makes with `keepalive: true`, so they outlive the
// page being hidden or unloaded (the ranked saver's flush on pagehide). A call
// sends its first fetch synchronously, so a flag scoped to that extent is
// enough; a later retry runs only while the page is alive. keepalive caps the
// body at 64KB; a maze is a few KB.
export const withKeepalive = <T>(fn: () => T): T => {
  keepalive = true;
  try {
    return fn();
  } finally {
    keepalive = false;
  }
};

// Methods safe to auto-retry on a transport failure (fetch rejected, or a
// gateway/non-JSON response, see TransportError), where the request most likely
// never landed. Retrying is sound only when a repeat can't double-apply: reads
// and idempotent writes. EXCLUDED:
//   - updateRun   — runSaver.ts owns its own coalescing retry+backoff.
//   - startRun    — a lost response after the server acted must not be redone.
//   - merge       — destructive, one-shot.
//   - deleteAccount — on success the client resets its local id, so a blind
//                   retry would act on the stale id.
//   - reportClientError — retrying reports risks amplifying a bad loop.
// setFlags is retryable: it writes the whole flag set as an absolute value.
// commitRun is retryable: free play's commit carries a per-attempt clientId and
// the server INSERT is guarded on it, and a legacy bare commit is an idempotent
// flip-to-non-void.
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

// Backoff before each retry (ms); its length is the retry count. Jitter keeps
// clients reconnecting together from retrying in lockstep.
const RETRY_BACKOFF_MS = [400, 1_200, 3_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A response that is not the API answering: nginx's HTML 502/503/504 while the
// upstream restarts (every deploy), or any other non-JSON body. The request
// most likely never reached the app, so it is a transport failure, not a server
// verdict: retryable methods retry it, and it feeds the connection tracker
// rather than the error channel.
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

// Fetch and decode a call, retrying transport failures (fetch rejecting, or a
// TransportError) for RETRYABLE methods; others throw on the first. A JSON
// answer, error statuses included, is a server verdict and is returned as-is.
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
  // Observed so an early failure isn't an unhandled rejection; the consuming
  // call still sees it.
  p.catch(() => {});
  setPrime(primeKey(method, input), p);
};

// Prime one method's next call from a slice of a shared composite response
// (the general form of primeBoot). `source` is a composite fetch already in
// flight (e.g. `api.dayView(...)`), `pick` selects this method's slice, and it
// is stashed under the input the consumer will send. If the source fails at
// transport or returns an error, the primed promise rejects and the consumer
// falls through to its own fetch.
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
  setPrime(primeKey(method, input), p);
};

// Prime the whole cold boot from ONE request. `boot` composes the handlers
// server-side; each is primed with a promise that awaits that single fetch and
// hands back its slice as a synthetic Response, keyed by the input its consumer
// sends (see the table below).
//
// `listInputs` are the calendar's mount-month ranges, in the order boot returns
// them ([current, prev]). They are a parameter because the dailyItems store
// owns that range shape and importing it here would be an api<->store cycle.
//
// If boot fails at transport (or returns a top-level auth error) each slice
// rejects and its consumer falls through to a real fetch.
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
    setPrime(primeKey(method, consumerInput), slice(pick));
  }
  // Each calendar month, keyed by its range, against boot.list[i].
  listInputs.forEach((li, i) => {
    setPrime(primeKey("list", li), slice((b) => b.list[i]));
  });

  // A `/YYYYMMDD` deep-link boot: `day` is set, so boot also carries the linked
  // day's slices (`b.linked`). Prime the three requests consumeDeepLink,
  // showBoard and the dock fire for that day. A slice with no linked day
  // throws, so its consumer falls through to a real fetch.
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
    setPrime(
      primeKey("standings", { year: ly, month: lm, day: ld }),
      linkedSlice((l) => l.standings),
    );
    // The board (showBoard) and the dock's standings key off the ITERATION,
    // which is known only once boot lands, so those primes are set then. A
    // consumer that gets there first just fetches for real.
    bootData.then((b) => {
      const linked = b?.linked;
      if (!linked || typeof linked.iteration !== "number") return;
      const it = linked.iteration;
      setPrime(
        primeKey("getBoard", { iteration: it, timeZone: tz }),
        Promise.resolve(new Response(JSON.stringify(linked.board))),
      );
      setPrime(
        primeKey("standings", { iteration: it }),
        Promise.resolve(new Response(JSON.stringify(linked.standings))),
      );
    }).catch(() => {});
  }

  // Returned so the caller can seed today's iteration id (see primeSession in
  // boot.ts); the standings dock needs it to recognize the staged board as
  // today and consume the primed { timeZone } slice.
  return bootData as Promise<MessageMap["boot"]>;
};

// Relay a failed request to the server's log, throttled per method + status by
// util/reportGate.ts so a polling or retrying caller doesn't send one report
// per attempt. Never reports a failed `reportClientError`: it rides this same
// proxy, so during an outage each failed report would fire another.
// Fire-and-forget.
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
      const preloaded = primed.take(key);
      let resp: Response;
      let data: unknown;
      try {
        // A primed fetch that fails at transport falls through to a fresh,
        // retried fetch instead of surfacing a boot-time blip as an error.
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
        // Transport failure that survived any retries: feed the connection
        // tracker, which shows the Disconnected overlay once failures persist.
        // A non-JSON body that is not a gateway page is reported; gateway pages
        // happen every deploy and the server isn't up to hear them.
        noteFailure();
        if (
          err instanceof TransportError && !GATEWAY_STATUSES.has(err.status)
        ) {
          reportFailedRequest(method, err.status, err.message);
        }
        throw err;
      }
      noteSuccess();
      // A server build newer than this bundle marks the tab stale (see
      // store/version.ts, useVersionRefresh). Synthetic primed responses carry
      // no header, so this is a no-op for them.
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
