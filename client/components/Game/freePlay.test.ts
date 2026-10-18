import { assertEquals, assertRejects } from "@std/assert";
import { storage } from "../../util/storage.ts";
import {
  clearFreePlay,
  clearFreePlayOutbox,
  commitFreePlay,
  flushFreePlayOutbox,
  freePlayClientId,
  pendingFreePlay,
  persistFreePlay,
  resumableFreePlay,
} from "./freePlay.ts";

// Deno provides a real localStorage, so these exercise the actual
// persist/resume pair. Each test starts and ends from a clean slate.

const NOW = 1_700_000_000_000;

Deno.test("free play resume: same board within the window resumes and keeps the record", () => {
  clearFreePlay();
  const id = freePlayClientId();
  persistFreePlay(7, NOW + 30_000, [
    { x: 5, y: 5 },
    { x: 6, y: 6, thunder: true },
  ]);

  const resumed = resumableFreePlay(7, NOW);
  assertEquals(resumed?.iteration, 7);
  assertEquals(resumed?.clientId, id);
  assertEquals(resumed?.blocks.length, 2);
  // The record survives a resume: a reload mid-build can resume again.
  assertEquals(resumableFreePlay(7, NOW)?.iteration, 7);

  clearFreePlay();
});

Deno.test("free play resume: staging another day skips the record but KEEPS it", () => {
  clearFreePlay();
  persistFreePlay(7, NOW + 30_000, [{ x: 5, y: 5 }]);

  // Wandering off doesn't abandon the build: the other board gets nothing...
  assertEquals(resumableFreePlay(8, NOW), null);
  // ...but the record survives, so returning within the window resumes. Only
  // clearFreePlay or expiry ends the attempt.
  assertEquals(resumableFreePlay(7, NOW)?.iteration, 7);

  clearFreePlay();
});

Deno.test("free play pending: the expiry hand-off reads the record past its deadline", () => {
  clearFreePlay();
  const id = freePlayClientId();
  persistFreePlay(7, NOW + 30_000, [{ x: 5, y: 5 }]);

  // The hand-off happens as the deadline check starts failing: resume refuses
  // the expired record, pending still hands it over with its idempotency id.
  assertEquals(resumableFreePlay(7, NOW + 60_000), null);
  const pending = pendingFreePlay(7);
  assertEquals(pending?.iteration, 7);
  assertEquals(pending?.clientId, id);
  // Another board (or an emptied build) still gets nothing to execute.
  assertEquals(pendingFreePlay(8), null);
  persistFreePlay(7, NOW + 30_000, []);
  assertEquals(pendingFreePlay(7), null);

  clearFreePlay();
});

Deno.test("free play resume: an expired, empty, or reset record does not resume", () => {
  clearFreePlay();
  persistFreePlay(7, NOW - 1, [{ x: 5, y: 5 }]);
  assertEquals(resumableFreePlay(7, NOW), null);

  persistFreePlay(7, NOW + 30_000, []);
  assertEquals(resumableFreePlay(7, NOW), null);

  persistFreePlay(7, NOW + 30_000, [{ x: 5, y: 5 }]);
  clearFreePlay();
  assertEquals(resumableFreePlay(7, NOW), null);
});

// --- The commit outbox -------------------------------------------------------
// A stubbed fetch stands in for the server, so the real api client (retries,
// transport classification) is exercised end to end.

// getId reads the URL for sign-in links; Deno has no `location` by default.
Object.defineProperty(globalThis, "location", {
  value: { pathname: "/", hash: "" },
  configurable: true,
});

const queued = () =>
  JSON.parse(storage.getItem("blocktol.freeplay.outbox") ?? "[]") as {
    clientId: string;
  }[];

const withFetch = async (
  answer: (init?: RequestInit) => Response,
  body: () => Promise<unknown>,
) => {
  const real = globalThis.fetch;
  globalThis.fetch = (_url, init) => Promise.resolve(answer(init));
  try {
    await body();
  } finally {
    globalThis.fetch = real;
  }
};

const landed = () =>
  Response.json({ kind: "commitRun", iteration: 7, created: NOW });

Deno.test("commit outbox: a landed commit leaves nothing queued", async () => {
  clearFreePlayOutbox();
  await withFetch(landed, () => commitFreePlay(7, [{ x: 5, y: 5 }], 10));
  assertEquals(queued(), []);
  clearFreePlay();
});

Deno.test("commit outbox: a verdict on the maze is dropped, a server fault is kept", async () => {
  clearFreePlayOutbox();
  await withFetch(
    () =>
      Response.json({ error: "too many blocks", status: 400 }, { status: 400 }),
    () => commitFreePlay(7, [{ x: 5, y: 5 }], 10),
  );
  assertEquals(queued(), []);
  clearFreePlay();

  await withFetch(
    () =>
      Response.json({ error: "failed to commit run", status: 500 }, {
        status: 500,
      }),
    () => commitFreePlay(7, [{ x: 5, y: 5 }], 10),
  );
  assertEquals(queued().length, 1);
  clearFreePlay();

  await withFetch(landed, flushFreePlayOutbox);
  assertEquals(queued(), []);
});

Deno.test("commit outbox: a gateway page is a transport failure — retried, then queued and replayed", async () => {
  clearFreePlayOutbox();
  let calls = 0;
  await withFetch(() => {
    calls++;
    return new Response("<html>502 Bad Gateway</html>", { status: 502 });
  }, () => assertRejects(() => commitFreePlay(7, [{ x: 5, y: 5 }], 10)));
  // The first try plus every retry, and the run is still held.
  assertEquals(calls > 1, true);
  const [entry] = queued();
  assertEquals(typeof entry?.clientId, "string");
  clearFreePlay();

  // Back online: the flush re-sends it under the SAME client id.
  let sentId: string | undefined;
  await withFetch((init) => {
    sentId = JSON.parse(String(init?.body)).clientId;
    return landed();
  }, flushFreePlayOutbox);
  assertEquals(sentId, entry.clientId);
  assertEquals(queued(), []);
});

Deno.test("commit outbox: one queued run per board — the best, ties keep the earlier", async () => {
  clearFreePlayOutbox();
  const fault = () =>
    Response.json({ error: "failed to commit run", status: 500 }, {
      status: 500,
    });
  const times = () =>
    (queued() as unknown as { iteration: number; time: number }[])
      .map((e) => [e.iteration, e.time]);

  // Each commit fails, so whatever the queue keeps is all that's left.
  const commitFailing = async (iteration: number, time: number) => {
    await withFetch(
      fault,
      () => commitFreePlay(iteration, [{ x: 5, y: 5 }], time),
    );
    clearFreePlay(); // next attempt gets a fresh client id
  };

  await commitFailing(7, 10);
  await commitFailing(7, 8); // worse: not queued
  assertEquals(times(), [[7, 10]]);
  await commitFailing(7, 10); // tie: the earlier stays
  assertEquals(times(), [[7, 10]]);
  await commitFailing(7, 12); // better: replaces
  assertEquals(times(), [[7, 12]]);
  await commitFailing(8, 3); // another board queues alongside
  assertEquals(times(), [[7, 12], [8, 3]]);

  clearFreePlayOutbox();
});
