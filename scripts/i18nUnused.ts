// `deno task i18n:unused` — a CI gate (blocking) that fails when a key in any
// catalog's en.json (see CATALOGS in i18nLib.ts) is referenced by no code.
// Greenfield + the never-interpolate-a-key convention (every live key appears as
// a string literal exactly once, e.g. in notificationText's variant ternary)
// makes the scan exact: walk the source roots, collect string literals, and flag
// any en.json key that appears in none.
// Dead copy therefore can't accumulate — a stray key fails the build like a
// missing translation.

import { CATALOGS, readJson, type SourceCatalog } from "./i18nLib.ts";

const ROOTS = ["common", "server", "client"];
// The compiled catalogs spell out every key, so they'd satisfy the scan by
// themselves — skip every generated module.
const GENERATED = ".generated.ts";

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
      !e.name.endsWith(GENERATED)
    ) {
      yield await Deno.readTextFile(child);
    }
  }
}

const unused = (k: string) =>
  !corpus.includes(`"${k}"`) && !corpus.includes(`'${k}'`);

let total = 0;
const dead: string[] = [];
for (const { dir } of CATALOGS) {
  const keys = Object.keys(await readJson<SourceCatalog>(`${dir}en.json`));
  total += keys.length;
  for (const k of keys) if (unused(k)) dead.push(`i18n/${dir}en.json: ${k}`);
}

if (dead.length) {
  console.error(
    `i18n:unused failed — ${dead.length} key(s) unused by any code:`,
  );
  for (const k of dead) console.error(`  ${k}`);
  console.error(
    "Remove them from their en.json (translations prune automatically).",
  );
  Deno.exit(1);
}
console.log(`i18n:unused ok — all ${total} keys referenced`);
