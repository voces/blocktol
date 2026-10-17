// Build step: move the client bundle's source map out of public/ (so it's never
// served) into sourcemaps/<SHA>/, keyed by the build SHA every request logs as
// `clientSha`, and keep only the newest KEEP builds. `deno task symbolicate`
// reads it from there. See CLAUDE.md "Build SHA / stale-client reload".
import { SHA } from "../common/version.ts";

const KEEP = 20;
const root = new URL("../", import.meta.url);
const built = new URL("public/js/index.js.map", root);
const dir = new URL(`sourcemaps/${SHA}/`, root);

await Deno.mkdir(dir, { recursive: true });
await Deno.rename(built, new URL("index.js.map", dir));

const builds: { name: string; mtime: number }[] = [];
for await (const e of Deno.readDir(new URL("sourcemaps/", root))) {
  if (!e.isDirectory) continue;
  const info = await Deno.stat(new URL(`sourcemaps/${e.name}`, root));
  builds.push({ name: e.name, mtime: info.mtime?.getTime() ?? 0 });
}
builds.sort((a, b) => b.mtime - a.mtime);
for (const old of builds.slice(KEEP)) {
  await Deno.remove(new URL(`sourcemaps/${old.name}`, root), {
    recursive: true,
  });
}
console.log(`source map: sourcemaps/${SHA}/index.js.map`);
