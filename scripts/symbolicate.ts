// Turn a minified client stack (a `client.error` from VictoriaLogs) back into
// source positions.
//
//   deno task symbolicate <clientSha> < stack.txt
//
// The SHA is the request's `clientSha` (logged on its "request start" line,
// same trace_id as the error). The map comes from sourcemaps/<SHA>/ (written by
// every build); failing that, the commit is rebuilt in a temporary worktree.
// The bundle is deterministic, so the rebuild matches given the same Deno
// version.
import { decodeMappings, originalPosition, SourceMap } from "./sourcemap.ts";

const [sha] = Deno.args;
if (!sha) {
  console.error("usage: deno task symbolicate <clientSha> < stack.txt");
  Deno.exit(1);
}
const root = new URL("../", import.meta.url);

const run = async (cmd: string, args: string[], cwd: URL | string) => {
  const out = await new Deno.Command(cmd, { args, cwd, stderr: "inherit" })
    .output();
  if (!out.success) throw new Error(`${cmd} ${args.join(" ")} failed`);
};

const rebuild = async (): Promise<string> => {
  const tmp = await Deno.makeTempDir({ prefix: `blocktol-${sha}-` });
  console.error(`no stored map for ${sha}; rebuilding in ${tmp}`);
  await run("git", ["worktree", "add", "--detach", tmp, sha], root);
  try {
    await run("deno", ["task", "i18n"], tmp);
    await run("deno", ["task", "version"], tmp);
    await run("deno", [
      "bundle",
      "--unstable-bundle",
      "--platform",
      "browser",
      "--minify",
      "--sourcemap=external",
      "client/index.ts",
      "-o",
      "public/js/index.js",
    ], tmp);
    return await Deno.readTextFile(`${tmp}/public/js/index.js.map`);
  } finally {
    await run("git", ["worktree", "remove", "--force", tmp], root);
  }
};

const stored = new URL(`sourcemaps/${sha}/index.js.map`, root);
const text = await Deno.readTextFile(stored).catch(rebuild);
const map: SourceMap = JSON.parse(text);
const decoded = decodeMappings(map.mappings);

// Sources are relative to public/js/; show repo files from the repo root.
const tidy = (source: string) =>
  source.replace(/^(\.\.\/)+/, "").replace(
    /^.*\/registry\.npmjs\.org\//,
    "npm:",
  );

const stack = new TextDecoder().decode(
  await new Response(Deno.stdin.readable).arrayBuffer(),
);
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
