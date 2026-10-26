import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import { api, MAX_BODY_BYTES, readBodyLimited } from "./api.ts";
import { clientFields } from "./reportClientError.ts";

// `duplex` is required for a streamed body (the fetch spec; Node enforces it)
// and absent from the DOM lib's RequestInit.
const post = (body: BodyInit | null, headers?: HeadersInit) =>
  new Request("http://x.test/api/m", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);

test("api: a prototype key is an unknown method, not a 500", async () => {
  for (const method of ["constructor", "toString", "__proto__", "nope"]) {
    const res = await api(post("{}"), { method });
    assertEquals(res?.status, 404, method);
  }
});

test("api: the largest legit body sits well under the cap", () => {
  // A full 400-piece maze (commitRun's zod cap) with every optional field set.
  const body = JSON.stringify({
    iteration: 2_000_000_000,
    clientId: crypto.randomUUID(),
    blocks: Array.from({ length: 400 }, (_, i) => ({
      x: i % 20,
      y: Math.floor(i / 20),
      thunder: false,
    })),
  });
  assert(body.length * 4 < MAX_BODY_BYTES, `${body.length}`);
});

test("api: an oversized body is a 413", async () => {
  const res = await api(post("x".repeat(MAX_BODY_BYTES + 1)), {
    method: "pushConfig",
  });
  assertEquals(res?.status, 413);
});

test("readBodyLimited counts a streamed body", async () => {
  const stream = (n: number, size: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(size).fill(97));
        c.close();
      },
    });
  assertEquals(await readBodyLimited(post(stream(4, 10)), 40), "a".repeat(40));
  assertEquals(await readBodyLimited(post(stream(5, 10)), 40), null);
  // A lying-small content-length doesn't help; a large one short-circuits.
  assertEquals(
    await readBodyLimited(post("abc", { "content-length": "999" }), 40),
    null,
  );
  assertEquals(await readBodyLimited(post(null), 40), "");
});

test("clientFields namespaces and bounds a client payload", () => {
  const f = clientFields({
    userHash: "forged",
    error: "e".repeat(5000),
    nested: { a: 1 },
  });
  assertEquals(f.userHash, undefined);
  assertEquals(f["client.userHash"], "forged");
  assertEquals((f["client.error"] as string).length, 4001);
  assertEquals(f["client.nested"], '{"a":1}');
});
