// `deno task i18n:unused` — a CI gate (blocking) that fails when a key in
// en.json is referenced by no code. Greenfield + the never-interpolate-a-key
// convention (every live key appears as a string literal exactly once, e.g. in
// notificationText's variant ternary) makes the scan exact: walk the source
// roots, collect string literals, and flag any en.json key that appears in none.
// Dead copy therefore can't accumulate — a stray key fails the build like a
// missing translation.

import { readJson, type SourceCatalog } from "./i18nLib.ts";

const ROOTS = ["common", "server", "client"];
const GENERATED = "i18n.generated.ts";

const en = await readJson<SourceCatalog>("en.json");
const keys = Object.keys(en);

// Concatenate every source file's text once; a key is "used" if its quoted
// literal (single or double quote) appears anywhere.
let corpus = "";
for (const root of ROOTS) {
  const dir = new URL(`../${root}/`, import.meta.url);
  for await (const entry of walk(dir)) corpus += entry;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const child = new URL(`${e.name}${e.isDirectory ? "/" : ""}`, dir);
    if (e.isDirectory) {
      yield* walk(child);
    } else if (
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
      e.name !== GENERATED
    ) {
      yield await Deno.readTextFile(child);
    }
  }
}

const dead = keys.filter((k) =>
  !corpus.includes(`"${k}"`) && !corpus.includes(`'${k}'`)
);

if (dead.length) {
  console.error(
    `i18n:unused failed — ${dead.length} key(s) in en.json unused by any code:`,
  );
  for (const k of dead) console.error(`  ${k}`);
  console.error(
    "Remove them from i18n/en.json (translations prune automatically).",
  );
  Deno.exit(1);
}
console.log(`i18n:unused ok — all ${keys.length} keys referenced`);
