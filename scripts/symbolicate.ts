// Turn a minified client stack (a `client.error` from VictoriaLogs) back into
// source positions.
//
//   npm run symbolicate <clientSha> < stack.txt
//
// The SHA is the request's `clientSha` (logged on its "request start" line,
// same trace_id as the error). The map comes from sourcemaps/<SHA>/ (written by
// every build); failing that, the commit is rebuilt in a temporary worktree
// with its own `bundle` script, which reproduces the bundle exactly: esbuild is
// pinned. A commit from before package.json (#226) has Deno tasks instead, and
// rebuilds with the Deno it was built by.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { text as readAll } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import {
  decodeMappings,
  originalPosition,
  type SourceMap,
} from "./sourcemap.ts";

const [sha] = process.argv.slice(2);
if (!sha) {
  console.error("usage: npm run symbolicate <clientSha> < stack.txt");
  process.exit(1);
}
const root = fileURLToPath(new URL("../", import.meta.url));

// stdout would interleave with the symbolicated stack, so the build's own
// output goes to stderr.
const run = (cmd: string, args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { cwd },
      (err) =>
        err ? reject(new Error(`${cmd} ${args.join(" ")} failed`)) : resolve(),
    );
    child.stdout?.pipe(process.stderr);
    child.stderr?.pipe(process.stderr);
  });

const rebuild = async (): Promise<string> => {
  const tmp = await mkdtemp(join(tmpdir(), `blocktol-${sha}-`));
  console.error(`no stored map for ${sha}; rebuilding in ${tmp}`);
  await run("git", ["worktree", "add", "--detach", tmp, sha], root);
  try {
    const steps = ["i18n", "version", "bundle"];
    if (existsSync(join(tmp, "package.json"))) {
      await run("npm", ["ci"], tmp);
      for (const s of steps) await run("npm", ["run", s], tmp);
    } else {
      for (const s of steps) await run("deno", ["task", s], tmp);
    }
    return await readFile(join(tmp, "public/js/index.js.map"), "utf8");
  } finally {
    await run("git", ["worktree", "remove", "--force", tmp], root);
  }
};

const stored = join(root, `sourcemaps/${sha}/index.js.map`);
const text = await readFile(stored, "utf8").catch(rebuild);
const map: SourceMap = JSON.parse(text);
const decoded = decodeMappings(map.mappings);

// Sources are relative to public/js/; show repo files from the repo root.
const tidy = (source: string) =>
  source.replace(/^(\.\.\/)+/, "").replace(
    /^.*\/registry\.npmjs\.org\/|^node_modules\/(?:\.deno\/[^/]+\/node_modules\/)?/,
    "npm:",
  );

const stack = await readAll(process.stdin);
const frame =
  /(?:https?:\/\/[^\s()]*)?\/js\/index\.js(?:\?v=[0-9a-f]+)?:(\d+):(\d+)/g;
for (const line of stack.split("\n")) {
  console.log(line.replace(frame, (whole, l, c) => {
    const o = originalPosition(map, decoded, Number(l), Number(c));
    return o
      ? `${tidy(o.source)}:${o.line}:${o.column}${o.name ? ` (${o.name})` : ""}`
      : whole;
  }));
}
