// Writes Deno's runtime types to types/deno.generated.d.ts (gitignored) for
// `deno task typecheck`: the server calls Deno APIs, and tsc only knows them
// from a declaration file. `deno types` prints one that opens with
// triple-slash references to Deno's own libs, which tsc doesn't have; those
// lines are dropped, and tsconfig.json supplies the standard libs instead.
const out = await new Deno.Command(Deno.execPath(), { args: ["types"] })
  .output();
if (!out.success) throw new Error("deno types failed");
const types = new TextDecoder().decode(out.stdout)
  .split("\n")
  .filter((line) => !/^\/\/\/ <reference (lib|no-default-lib)=/.test(line))
  .join("\n");
await Deno.writeTextFile("types/deno.generated.d.ts", types);
