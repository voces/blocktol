import { test } from "node:test";
import { stat } from "node:fs/promises";
import { assertEquals } from "@std/assert";
import { eTag, parseRange, serveFile } from "./serveFile.ts";

const BODY = "0123456789";

// Committed fixtures: digits.* hold BODY with no trailing newline.
const DIR = "server/util/testdata/serveFile";

const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request("http://x.test/f", { method, headers });

const serve = async (path: string, req: Request) =>
  serveFile(req, path, await stat(path));

test("eTag is the tag @std/http's serveFile computed", async () => {
  // Pinned from @std/http 1.1.2, so caches holding its tags still get a 304.
  assertEquals(
    await eTag({ size: 10, mtime: new Date(0) }),
    'W/"a-fV7l2JDWcybWhXieoDDmVxKEFxe"',
  );
});

test("a plain GET streams the file with its validators", async () => {
  const path = `${DIR}/digits.txt`;
  const res = await serve(path, get());
  assertEquals(res.status, 200);
  assertEquals(await res.text(), BODY);
  assertEquals(res.headers.get("content-type"), "text/plain; charset=UTF-8");
  assertEquals(res.headers.get("content-length"), "10");
  assertEquals(res.headers.get("accept-ranges"), "bytes");
  const info = await stat(path);
  assertEquals(res.headers.get("etag"), await eTag(info));
  assertEquals(res.headers.get("last-modified"), info.mtime.toUTCString());
});

test("an unknown extension gets no content-type", async () => {
  const path = `${DIR}/digits.unknownext`;
  const res = await serve(path, get());
  assertEquals(res.headers.get("content-type"), null);
  await res.body?.cancel();
});

test("If-None-Match: a match is a 304, weak or strong, in a list or *", async () => {
  const path = `${DIR}/digits.txt`;
  const etag = await eTag(await stat(path));
  const strong = etag.slice(2);
  for (const inm of [etag, strong, `"other", ${etag}`, "*"]) {
    const res = await serve(path, get({ "if-none-match": inm }));
    assertEquals(res.status, 304, inm);
    assertEquals(res.body, null);
    assertEquals(res.headers.get("etag"), etag);
  }
  const miss = await serve(path, get({ "if-none-match": '"other"' }));
  assertEquals(miss.status, 200);
  await miss.body?.cancel();
});

test("If-Modified-Since: a 304 unless the file is newer, and never over an If-None-Match", async () => {
  const path = `${DIR}/digits.txt`;
  const { mtime } = await stat(path);
  const at = mtime.toUTCString(); // truncated to the second
  assertEquals(
    (await serve(path, get({ "if-modified-since": at }))).status,
    304,
  );
  const older = new Date(mtime.getTime() - 5_000).toUTCString();
  const fresh = await serve(path, get({ "if-modified-since": older }));
  assertEquals(fresh.status, 200);
  await fresh.body?.cancel();
  const both = await serve(
    path,
    get({ "if-modified-since": at, "if-none-match": '"other"' }),
  );
  assertEquals(both.status, 200);
  await both.body?.cancel();
});

test("Range: a single range is a 206 of exactly those bytes", async () => {
  const path = `${DIR}/digits.txt`;
  const cases: [range: string, body: string, contentRange: string][] = [
    ["bytes=2-4", "234", "bytes 2-4/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=8-100", "89", "bytes 8-9/10"],
    ["bytes=-100", BODY, "bytes 0-9/10"],
  ];
  for (const [range, body, cr] of cases) {
    const res = await serve(path, get({ range }));
    assertEquals(res.status, 206, range);
    assertEquals(await res.text(), body, range);
    assertEquals(res.headers.get("content-range"), cr, range);
    assertEquals(res.headers.get("content-length"), `${body.length}`);
  }
});

test("Range: past the end is a 416; a list or another unit serves the whole file", async () => {
  const path = `${DIR}/digits.txt`;
  for (const range of ["bytes=10-", "bytes=5-3", "bytes=-0"]) {
    const res = await serve(path, get({ range }));
    assertEquals(res.status, 416, range);
    assertEquals(res.headers.get("content-range"), "bytes */10");
    await res.body?.cancel();
  }
  for (const range of ["bytes=0-1,4-5", "items=0-1", "bytes=-"]) {
    const res = await serve(path, get({ range }));
    assertEquals(res.status, 200, range);
    assertEquals(await res.text(), BODY);
  }
});

test("an empty file ignores Range and has no body", async () => {
  const path = `${DIR}/empty.txt`;
  const res = await serve(path, get({ range: "bytes=0-10" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-length"), "0");
  assertEquals(await res.text(), "");
});

test("HEAD has the headers and no body; other methods are a 405", async () => {
  const path = `${DIR}/digits.txt`;
  const head = await serve(path, get({}, "HEAD"));
  assertEquals(head.status, 200);
  assertEquals(head.headers.get("content-length"), "10");
  assertEquals(head.body, null);
  const post = await serve(path, get({}, "POST"));
  assertEquals(post.status, 405);
  assertEquals(post.headers.get("allow"), "GET, HEAD");
  await post.body?.cancel();
});

test("parseRange", () => {
  assertEquals(parseRange("bytes=0-0", 5), { start: 0, end: 0 });
  assertEquals(parseRange(" bytes=1-2 ", 5), { start: 1, end: 2 });
  assertEquals(parseRange("bytes=5-", 5), "unsatisfiable");
  assertEquals(parseRange("bytes=", 5), null);
});
