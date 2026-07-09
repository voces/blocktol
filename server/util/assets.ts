// Boot-time asset fingerprinting. The app is served by this dynamic server, so
// rather than a build step that renames files, we hash the fingerprintable
// assets once (lazily, on first request) and:
//   - serve the app shell / manifest with `?v=<hash>` stamped onto their asset
//     refs, so a content change becomes a NEW url no cache can answer staleley;
//   - inject the version + precache list + notification-icon url into the SW;
//   - mark any correctly-versioned asset immutable for a year, while the shell,
//     SW, and manifest stay no-cache so new hashes always propagate.
//
// This is what fixes "I changed the icon but everyone still sees the old one":
// the icon lived at a stable url (`/favicon.svg`) that every layer — HTTP cache,
// the SW cache, the push notification — kept serving from cache.

import { join } from "@std/path/posix";

// Same-origin assets whose url should carry a content hash. Everything else
// (the shell, manifest, SW, the standalone debug pages) stays unversioned.
const FINGERPRINTED = ["/js/index.js", "/styles.css", "/favicon.svg"] as const;

const IMMUTABLE = "public, max-age=31536000, immutable";

// path -> content hash, for the assets that exist. A missing asset is simply
// absent (served unversioned) rather than crashing the build.
export type VersionMap = Record<string, string>;

// `Uint8Array<ArrayBuffer>` (not a bare `Uint8Array`, which defaults to
// `ArrayBufferLike`) is the shape WebCrypto's BufferSource params require under
// the strict typed-array generics — matching server/util/webpush.ts.
const shortHash = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// The versioned url for an asset, or the plain path when it isn't fingerprinted.
const versioned = (version: VersionMap, path: string) =>
  version[path] ? `${path}?v=${version[path]}` : path;

// Cache-Control for a static asset request: immutable when the `?v` matches the
// asset's CURRENT hash, else null (caller keeps serveFile's revalidating
// default). A stale `?v` therefore can't pin the wrong bytes as immutable.
export const immutableFor = (
  version: VersionMap,
  pathname: string,
  search: URLSearchParams,
): string | null => {
  const v = search.get("v");
  return v && version[pathname] === v ? IMMUTABLE : null;
};

// The pure transform: stamp `?v=` onto the shell/manifest refs and fill the SW's
// asset-manifest marker. No I/O, so it's unit-testable with in-memory strings.
export const stampAssets = (
  sources: { indexHtml: string; manifest: string; sw: string },
  version: VersionMap,
): { shell: string; sw: string; manifest: string } => {
  const v = (p: string) => versioned(version, p);

  // Shell: stamp the fingerprinted refs. The manifest link stays unversioned —
  // it's served no-cache and carries the versioned icon itself.
  const shell = sources.indexHtml
    .replaceAll('href="/styles.css"', `href="${v("/styles.css")}"`)
    .replaceAll('src="/js/index.js"', `src="${v("/js/index.js")}"`)
    .replaceAll('href="/favicon.svg"', `href="${v("/favicon.svg")}"`);

  // Manifest: version the icon (a relative "favicon.svg" ref).
  const icon = version["/favicon.svg"]
    ? `favicon.svg?v=${version["/favicon.svg"]}`
    : "favicon.svg";
  const manifest = sources.manifest.replaceAll('"favicon.svg"', `"${icon}"`);

  // One build id that changes whenever any precached asset changes — the SW
  // cache name keys off it, so a deploy that touches an asset purges the old
  // cache on activate.
  const assetVersion = FINGERPRINTED.map((p) => version[p] ?? "0").join("");
  const precache = [
    "/",
    "/index.html",
    v("/styles.css"),
    v("/js/index.js"),
    v("/favicon.svg"),
  ];
  const sw = sources.sw.replace(
    "/* __ASSET_MANIFEST__ */",
    [
      `ASSET_VERSION = ${JSON.stringify(assetVersion)};`,
      `PRECACHE = ${JSON.stringify(precache)};`,
      `ICON = ${JSON.stringify(v("/favicon.svg"))};`,
    ].join("\n"),
  );

  return { shell, sw, manifest };
};

export type Assets = {
  // The transformed app shell (index.html with `?v=` stamped), served for "/",
  // "/index.html", and the /YYYYMMDD permalink.
  shell: string;
  // The SW with its ASSET_MANIFEST marker filled in (version, precache, icon).
  sw: string;
  // The manifest with its icon url versioned.
  manifest: string;
  // Cache-Control for a static request (immutable for a correctly-versioned
  // asset, else null).
  cacheControlFor: (pathname: string, search: URLSearchParams) => string | null;
};

const buildAssets = async (publicDir: string): Promise<Assets> => {
  const root = join(Deno.cwd(), publicDir);
  const readText = (p: string) => Deno.readTextFile(join(root, p));

  // Hash each fingerprinted asset; a missing one (e.g. before a client build)
  // just stays unversioned rather than crashing boot.
  const version: VersionMap = {};
  await Promise.all(FINGERPRINTED.map(async (p) => {
    try {
      version[p] = await shortHash(await Deno.readFile(join(root, p)));
    } catch { /* leave unversioned */ }
  }));

  const [indexHtml, manifest, sw] = await Promise.all([
    readText("index.html"),
    readText("manifest.webmanifest"),
    readText("sw.js"),
  ]);
  const stamped = stampAssets({ indexHtml, manifest, sw }, version);

  return {
    ...stamped,
    cacheControlFor: (pathname, search) =>
      immutableFor(version, pathname, search),
  };
};

// Built once per isolate on first request (not at import) so tests and other
// entrypoints don't hit the filesystem; a failed build isn't cached, so the
// next request retries rather than being served the rejection.
let cached: Promise<Assets> | undefined;
export const assets = (publicDir: string): Promise<Assets> => {
  if (!cached) {
    cached = buildAssets(publicDir);
    cached.catch(() => {
      cached = undefined;
    });
  }
  return cached;
};
