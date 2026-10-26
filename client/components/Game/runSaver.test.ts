import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
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
    if (!String(url).endsWith("/updateRun")) {
      return Promise.resolve(Response.json({}));
    }
    return new Promise((resolve) =>
      sent.push({
        body: JSON.parse(String(init?.body)),
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
// The edits a request carried, without their index and age.
const edits = (s: Sent) => s.body.trace!.e.map((e) => e.slice(2));

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
    assertEquals(edits(sent[0]), [["p", 4, 4]]);
    sent[0].answer(accepted);
    await tick();

    saveRun({ iteration: 1, blocks: [a, c] }, 0);
    assertEquals(edits(sent[1]), [["m", 4, 4, 6, 6]]);
    const [i0] = sent[0].body.trace!.e[0];
    const [i1] = sent[1].body.trace!.e[0];
    assert(i1 > i0, "indexes count up within the page");
  }));

test("trace: saves coalesced behind one in flight keep every edit", () =>
  withServer(async (sent) => {
    beginRunTrace([]);
    saveRun({ iteration: 1, blocks: [a] }, 0);
    saveRun({ iteration: 1, blocks: [a, b] }, 0);
    saveRun({ iteration: 1, blocks: [a, b, c] }, 0);
    assertEquals(sent.length, 1, "one save in flight");
    sent[0].answer(accepted);
    await tick();
    assertEquals(edits(sent[1]), [["p", 4, 4], ["p", 6, 6]]);
  }));

test("trace: a rejected save's edits are dropped with the revert", () =>
  withServer(async (sent) => {
    beginRunTrace([a]);
    saveRun({ iteration: 1, blocks: [a, b] }, 0);
    sent[0].answer({ error: "invalid path" });
    await tick();
    // The board snapped back to [a]; the next edit diffs from there.
    saveRun({ iteration: 1, blocks: [a, c] }, 0);
    assertEquals(edits(sent[1]), [["p", 6, 6]]);
  }));

test("trace: nothing is recorded outside a ranked attempt", () =>
  withServer(async (sent) => {
    saveRun({ iteration: 1, blocks: [a] }, 0);
    assertEquals(sent[0].body.trace, undefined);
    sent[0].answer(accepted);
    await tick();
  }));
