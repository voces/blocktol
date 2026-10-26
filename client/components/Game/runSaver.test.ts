import { test } from "node:test";
import { assert, assertEquals, assertExists } from "@std/assert";
import {
  beginRunTrace,
  resetRunSaver,
  saveRun,
  setRunSaverHandlers,
} from "./runSaver.ts";

// A stubbed fetch stands in for the server, so these exercise the saver's edit
// trace through the real api client. Each request is held until the test
// answers it, which is how a save stays in flight while newer ones queue.

// getId reads the URL for sign-in links; Node has no `location`.
Object.defineProperty(globalThis, "location", {
  value: { pathname: "/", hash: "" },
  configurable: true,
});

type Sent = {
  body: {
    blocks: unknown[];
    trace?: { p: string; e: [number, ...unknown[]][] };
  };
  answer: (r: unknown) => void;
};

const withServer = async (body: (sent: Sent[]) => Promise<void>) => {
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    // The api client relays error answers to reportClientError; only the
    // saves are the server under test.
    const href = url instanceof Request ? url.url : url.toString();
    if (!href.endsWith("/updateRun")) {
      return Promise.resolve(Response.json({}));
    }
    const raw = init?.body;
    if (typeof raw !== "string") throw new Error("updateRun sent no JSON body");
    return new Promise((resolve) =>
      sent.push({
        body: JSON.parse(raw),
        answer: (r) => resolve(Response.json(r)),
      })
    );
  };
  resetRunSaver();
  try {
    await body(sent);
  } finally {
    resetRunSaver();
    globalThis.fetch = real;
  }
};

const accepted = { path: [], duration: 30, slows: [], supreme: false };
const tick = () => new Promise((r) => setTimeout(r, 0));
// The i-th save sent, failing the test when fewer went out.
const nth = (sent: Sent[], i: number) => {
  const s = sent[i];
  assertExists(s, `save ${i + 1} was sent`);
  return s;
};
const traceOf = (s: Sent) => {
  assertExists(s.body.trace, "the save carries a trace");
  return s.body.trace;
};
// The edits a request carried, without their index and age.
const edits = (s: Sent) => traceOf(s).e.map((e) => e.slice(2));
// The index of the first edit a request carried.
const firstIndex = (s: Sent) => {
  const [edit] = traceOf(s).e;
  assertExists(edit, "the save carries an edit");
  return edit[0];
};

const a = { x: 2, y: 2, local: true };
const b = { x: 4, y: 4, local: true };
const c = { x: 6, y: 6, local: true };

setRunSaverHandlers({
  onAccepted: () => {},
  onExpired: () => {},
  onRejected: () => {},
});

test("trace: each save carries only the edits not yet confirmed", () =>
  withServer(async (sent) => {
    beginRunTrace([a]);
    saveRun({ iteration: 1, blocks: [a, b] }, 0);
    assertEquals(edits(nth(sent, 0)), [["p", 4, 4]]);
    nth(sent, 0).answer(accepted);
    await tick();

    saveRun({ iteration: 1, blocks: [a, c] }, 0);
    assertEquals(edits(nth(sent, 1)), [["m", 4, 4, 6, 6]]);
    assert(
      firstIndex(nth(sent, 1)) > firstIndex(nth(sent, 0)),
      "indexes count up within the page",
    );
  }));

test("trace: saves coalesced behind one in flight keep every edit", () =>
  withServer(async (sent) => {
    beginRunTrace([]);
    saveRun({ iteration: 1, blocks: [a] }, 0);
    saveRun({ iteration: 1, blocks: [a, b] }, 0);
    saveRun({ iteration: 1, blocks: [a, b, c] }, 0);
    assertEquals(sent.length, 1, "one save in flight");
    nth(sent, 0).answer(accepted);
    await tick();
    assertEquals(edits(nth(sent, 1)), [["p", 4, 4], ["p", 6, 6]]);
  }));

test("trace: a rejected save's edits are dropped with the revert", () =>
  withServer(async (sent) => {
    beginRunTrace([a]);
    saveRun({ iteration: 1, blocks: [a, b] }, 0);
    nth(sent, 0).answer({ error: "invalid path" });
    await tick();
    // The board snapped back to [a]; the next edit diffs from there.
    saveRun({ iteration: 1, blocks: [a, c] }, 0);
    assertEquals(edits(nth(sent, 1)), [["p", 6, 6]]);
  }));

test("trace: nothing is recorded outside a ranked attempt", () =>
  withServer(async (sent) => {
    saveRun({ iteration: 1, blocks: [a] }, 0);
    assertEquals(nth(sent, 0).body.trace, undefined);
    nth(sent, 0).answer(accepted);
    await tick();
  }));
