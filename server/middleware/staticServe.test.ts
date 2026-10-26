import { existsSync } from "node:fs";
import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import { staticServe } from "./staticServe.ts";

// The real public/: assets() builds once per process, for the first dir asked.
const serve = staticServe("public");
const get = (path: string) => serve(new Request("http://x.test" + path), {});

test("staticServe: the shell is served from memory, no-cache", async () => {
  const res = await get("/");
  assert(res);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "no-cache");
  assert((await res.text()).includes("<html"));
});

test("staticServe: a file on disk carries an ETag and no year-long cache", async () => {
  const res = await get("/robots.txt");
  assert(res);
  assertEquals(res.status, 200);
  assert(res.headers.get("etag")?.startsWith('W/"'));
  assertEquals(res.headers.get("cache-control"), null);
  await res.body?.cancel();
});

test("staticServe: immutable only at the current ?v", async () => {
  const res = await get("/");
  assert(res);
  const shell = await res.text();
  const v = /href="\/styles\.css\?v=([0-9a-f]+)"/.exec(shell)?.[1];
  assert(v, "the shell stamps styles.css with its hash");
  const current = await get(`/styles.css?v=${v}`);
  assertEquals(
    current?.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  await current?.body?.cancel();
  const stale = await get("/styles.css?v=000000000000");
  assertEquals(stale?.headers.get("cache-control"), null);
  await stale?.body?.cancel();
});

test("staticServe: nothing outside public/ is reachable", async () => {
  // The target must exist, or a miss proves nothing about traversal.
  assert(existsSync("package.json"), "run from the repo root");
  for (
    const path of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/fonts/../../package.json",
      "/..%2fpackage.json",
    ]
  ) {
    assertEquals(await get(path), undefined, path);
  }
});

test("staticServe: a missing file or a directory without index.html falls through", async () => {
  assertEquals(await get("/nope.txt"), undefined);
  assertEquals(await get("/fonts"), undefined);
  assertEquals(await get("/fonts/"), undefined);
});
