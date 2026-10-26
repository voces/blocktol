// `npm run i18n:unused` — a blocking CI gate that fails when a key in any
// catalog's en.json (see CATALOGS in i18nLib.ts) is referenced by no code.
// Keys are never interpolated (each live key appears as a string literal, e.g.
// in notificationText's variant ternary), so a scan of the source roots for the
// quoted key is exact.

import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { CATALOGS, readJson, type SourceCatalog } from "./i18nLib.ts";

const ROOTS = ["common", "server", "client"];
// Generated catalogs spell out every key and would satisfy the scan: skip them.
const GENERATED = ".generated.ts";

// A key is "used" if its quoted literal appears anywhere in the source text.
let corpus = "";
for (const root of ROOTS) {
  const dir = new URL(`../${root}/`, import.meta.url);
  for await (const entry of walk(dir)) corpus += entry;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
    if (e.isDirectory()) {
      yield* walk(child);
    } else if (
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
      !e.name.endsWith(GENERATED)
    ) {
      yield await readFile(child, "utf8");
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
  process.exit(1);
}
console.log(`i18n:unused ok — all ${total} keys referenced`);
