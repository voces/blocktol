// Build step: move the client bundle's source map out of public/ (so it's never
// served) into sourcemaps/<SHA>/, keyed by the `clientSha` every request logs,
// and keep the newest KEEP builds. `npm run symbolicate` reads it from there.
// See server/CLAUDE.md "Build SHA / stale-client reload".
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { SHA } from "../common/version.ts";

const KEEP = 20;
const root = new URL("../", import.meta.url);
const built = new URL("public/js/index.js.map", root);
const dir = new URL(`sourcemaps/${SHA}/`, root);

await mkdir(dir, { recursive: true });
await rename(built, new URL("index.js.map", dir));

const builds: { name: string; mtime: number }[] = [];
const entries = await readdir(new URL("sourcemaps/", root), {
  withFileTypes: true,
});
for (const e of entries) {
  if (!e.isDirectory()) continue;
  const info = await stat(new URL(`sourcemaps/${e.name}`, root));
  builds.push({ name: e.name, mtime: info.mtime.getTime() });
}
builds.sort((a, b) => b.mtime - a.mtime);
for (const old of builds.slice(KEEP)) {
  await rm(new URL(`sourcemaps/${old.name}`, root), { recursive: true });
}
console.log(`source map: sourcemaps/${SHA}/index.js.map`);
