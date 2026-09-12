import { assert, assertEquals } from "@std/assert";
import { immutableFor, stampAssets, VersionMap } from "./assets.ts";

const version: VersionMap = {
  "/js/index.js": "aaaa11",
  "/styles.css": "bbbb22",
  "/favicon.svg": "cccc33",
};

const sources = {
  indexHtml:
    `<link rel="manifest" href="/manifest.webmanifest" /><link rel="icon" href="/favicon.svg" type="image/svg+xml" /><link rel="stylesheet" href="/styles.css" /><script src="/js/index.js" type="module"></script>`,
  manifest: `{"icons":[{"src":"favicon.svg","sizes":"any"}]}`,
  sw:
    `let ASSET_VERSION = "dev";\nlet PRECACHE = ["/"];\nlet ICON = "/favicon.svg";\nlet VAPID_PUBLIC_KEY = "";\n/* __ASSET_MANIFEST__ */\nconst C = ASSET_VERSION;`,
};

Deno.test("stamps ?v= onto the shell's fingerprinted refs, leaves manifest link", () => {
  const { shell } = stampAssets(sources, version);
  assert(shell.includes('href="/styles.css?v=bbbb22"'));
  assert(shell.includes('src="/js/index.js?v=aaaa11"'));
  assert(shell.includes('href="/favicon.svg?v=cccc33"'));
  // The manifest link is deliberately NOT versioned (it's served no-cache).
  assert(shell.includes('href="/manifest.webmanifest"'));
});

Deno.test("versions the manifest icon", () => {
  const { manifest } = stampAssets(sources, version);
  assertEquals(
    manifest,
    `{"icons":[{"src":"favicon.svg?v=cccc33","sizes":"any"}]}`,
  );
});

Deno.test("fills the SW marker with version, precache, and icon", () => {
  const { sw } = stampAssets(sources, version);
  assert(!sw.includes("__ASSET_MANIFEST__"), "marker should be replaced");
  // Build id changes whenever any fingerprinted asset changes.
  assert(sw.includes('ASSET_VERSION = "aaaa11bbbb22cccc33";'));
  assert(sw.includes('ICON = "/favicon.svg?v=cccc33";'));
  // Precache carries the versioned shell.
  assert(sw.includes('"/styles.css?v=bbbb22"'));
  assert(sw.includes('"/js/index.js?v=aaaa11"'));
  assert(sw.includes('"/favicon.svg?v=cccc33"'));
  assert(sw.includes('"/index.html"'));
});

Deno.test("injects the VAPID public key so the SW can re-subscribe alone", () => {
  // `pushsubscriptionchange` fires with no page open, so the SW can't fetch the
  // key from /api/pushConfig — it has to be baked in (see public/sw.js).
  const { sw } = stampAssets(sources, version, "BKd0F0RQ");
  assert(sw.includes('VAPID_PUBLIC_KEY = "BKd0F0RQ";'));
});

Deno.test("an unconfigured VAPID key injects an empty string, not null", () => {
  // The SW guards on a falsy key; `null` would also be falsy but wouldn't match
  // the `let VAPID_PUBLIC_KEY = ""` declaration's type.
  const { sw } = stampAssets(sources, version);
  assert(sw.includes('VAPID_PUBLIC_KEY = "";'));
});

Deno.test("a missing asset stays unversioned rather than breaking", () => {
  const { shell, sw } = stampAssets(sources, { "/styles.css": "bbbb22" });
  assert(shell.includes('href="/styles.css?v=bbbb22"'));
  assert(shell.includes('src="/js/index.js"')); // no ?v — not hashed
  assert(shell.includes('href="/favicon.svg"'));
  assert(sw.includes('ICON = "/favicon.svg";'));
});

Deno.test("immutable only for a matching current ?v", () => {
  const p = (v: string) => new URLSearchParams(v);
  assertEquals(
    immutableFor(version, "/js/index.js", p("v=aaaa11")),
    "public, max-age=31536000, immutable",
  );
  // Stale hash → not immutable (would otherwise pin the wrong bytes).
  assertEquals(immutableFor(version, "/js/index.js", p("v=old")), null);
  // No ?v → revalidate.
  assertEquals(immutableFor(version, "/js/index.js", p("")), null);
  // Not a fingerprinted asset → revalidate.
  assertEquals(immutableFor(version, "/robots.txt", p("v=aaaa11")), null);
});
