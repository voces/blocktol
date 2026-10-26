// Serve one regular file from disk: a weak ETag and Last-Modified, a 304 on a
// matching If-None-Match (or, without one, an If-Modified-Since no older than
// the file), a single `bytes=` Range as a 206 (416 when it can't be met), and
// a streamed body. The caller has already stat'ed the path and decided it is a
// file (staticServe falls through on anything else).

import { createReadStream, type Stats } from "node:fs";
import { Buffer } from "node:buffer";
import { extname } from "node:path";
import { Readable } from "node:stream";

// The types public/ holds. An extension missing here gets no content-type
// (nosniff then keeps the browser from guessing).
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "text/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".webmanifest": "application/manifest+json; charset=UTF-8",
  ".txt": "text/plain; charset=UTF-8",
  ".md": "text/markdown; charset=UTF-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/vnd.microsoft.icon",
  ".woff2": "font/woff2",
};

export type FileInfo = Pick<Stats, "size" | "mtime">;

// Size and a hash of the mtime: the same tag @std/http's serveFile computed, so
// caches holding its ETags still revalidate to a 304.
export const eTag = async ({ size, mtime }: FileInfo): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(mtime.toJSON()),
  );
  const hash = Buffer.from(digest).toString("base64").slice(0, 27);
  return `W/"${size.toString(16)}-${hash}"`;
};

// Weak comparison (RFC 9110 §13.1.2): `W/` is ignored on both sides.
const matchesETag = (header: string, etag: string): boolean => {
  if (header.trim() === "*") return true;
  const strip = (t: string) => t.startsWith("W/") ? t.slice(2) : t;
  return header.split(",").some((t) => strip(t.trim()) === strip(etag));
};

const notModified = (req: Request, etag: string, mtime: Date): boolean => {
  const inm = req.headers.get("if-none-match");
  if (inm !== null) return matchesETag(inm, etag);
  const ims = req.headers.get("if-modified-since");
  // HTTP dates have whole seconds; the file's mtime has milliseconds.
  return ims !== null && mtime.getTime() < new Date(ims).getTime() + 1000;
};

// One `bytes=` range, clamped to the file: `a-b`, `a-` (to the end) or `-n`
// (the last n). Anything else (a range list, another unit) is ignored and the
// whole file served; a range that starts past the end is unsatisfiable.
export const parseRange = (
  header: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null => {
  const m = /^bytes=(\d+)?-(\d+)?$/.exec(header.trim());
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const start = m[1] === undefined ? size - Number(m[2]) : Number(m[1]);
  const end = m[1] === undefined || m[2] === undefined
    ? size - 1
    : Number(m[2]);
  if (end < start || start >= size) return "unsatisfiable";
  return { start: Math.max(0, start), end: Math.min(end, size - 1) };
};

const stream = (path: string, start: number, end: number) =>
  Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<
    Uint8Array
  >;

export const serveFile = async (
  req: Request,
  path: string,
  info: FileInfo,
): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const etag = await eTag(info);
  const headers = new Headers({
    "accept-ranges": "bytes",
    etag,
    "last-modified": info.mtime.toUTCString(),
  });
  const type = CONTENT_TYPES[extname(path).toLowerCase()];
  if (type) headers.set("content-type", type);

  if (notModified(req, etag, info.mtime)) {
    return new Response(null, { status: 304, headers });
  }

  const { size } = info;
  // An empty file ignores Range: some clients send one on every request, and
  // nothing in a 0-byte file can satisfy it.
  const rangeHeader = req.headers.get("range");
  const range = rangeHeader && size > 0 ? parseRange(rangeHeader, size) : null;
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${size}`);
    return new Response("Range Not Satisfiable", { status: 416, headers });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers.set("content-length", `${end - start + 1}`);
  if (range) headers.set("content-range", `bytes ${start}-${end}/${size}`);
  const status = range ? 206 : 200;
  // createReadStream's `end` is inclusive; an empty file has no byte to read.
  const body = req.method === "HEAD" || size === 0
    ? null
    : stream(path, start, end);
  return new Response(body, { status, headers });
};
