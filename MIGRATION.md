# Deno 2 + new Deno Deploy migration

This repo has been migrated off **Deno Deploy Classic** (shutting down
**2026-07-20**) and the Deno 1.x toolchain, onto **Deno 2** and the **new Deno
Deploy** (`app.deno.com`, GA'd Feb 2026).

## What changed in the code

| Area                          | Before                                                                 | After                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| HTTP server                   | `serve()` from `std/http/server.ts`                                    | built-in `Deno.serve()` (`server/index.ts`)                                                                                 |
| Periodic iteration generation | `setInterval` (dies on idle/evicted isolates)                          | `Deno.cron("ensure-iterations", "* * * * *", …)` in `server/util/gen.ts`                                                    |
| Leader election               | `BroadcastChannel` (Classic-only, was vestigial)                       | **removed** (`channel.ts`, `trackLeadership.ts`, `ServerMessage.ts` deleted); generation is idempotent via a DB check       |
| New Relic metrics             | in-memory buffer flushed on `setInterval`                              | fire-and-forget per event (`server/util/metrics.ts`) — **note: this module is currently not imported anywhere / dead code** |
| Dependencies                  | `import_map.json` with `esm.sh` + `deno.land/x` + `deno.land/std` URLs | `deno.jsonc` `imports` with `npm:` / `jsr:` specifiers                                                                      |
| Client bundle                 | `deno bundle a b` (Deno 1)                                             | `deno bundle --unstable-bundle --platform browser … -o …`                                                                   |
| Dev scripts                   | shell scripts (`./bundle`, `./run`, `./dev`, …)                        | `deno task` entries in `deno.jsonc`                                                                                         |
| Deploy                        | GitHub Action w/ `denoland/deployctl@v1` (sunset)                      | Deno Deploy GitHub integration; `.github/workflows/ci.yml` only checks code                                                 |

### Tasks

```
deno task build      # bundle client JS -> public/js/ (also the Deploy build step)
deno task start      # run the server
deno task dev        # watch-bundle client + watch-run server
deno task test       # run tests
deno task preview    # static-serve the repo on :8081
```

## Dashboard steps to finish the migration (do before 2026-07-20)

These can only be done in the Deno console — they are not in the repo:

1. **Create the app** at <https://app.deno.com> and **connect the
   `voces/blocktol` GitHub repo**. The build/runtime config is already in
   `deno.jsonc` under `deploy` (`runtime.type: "dynamic"`,
   `entrypoint: ./server/index.ts`, build = `deno task build`). No `deployctl` /
   Actions YAML is needed anymore.
2. **Environments.** Use one app with a **Production** context (prod) and a
   **Development** context (dev), replacing the old `blocktol-dev` /
   `blocktol-prod` projects.
3. **Environment variables** (dashboard → env vars, per context — NOT the Build
   context):
   - `SQL_PASSWORD` — **secret**
   - `NEW_RELIC_API_KEY` — **secret** (only needed if metrics get wired up)
   - `DENO_ENV` — plain text (`prod` in Production, `dev` in Development)
   - `PORT` — do **not** set; the platform manages the listen port.
4. **Domains.** Re-point the custom domain(s) to the new app.
5. Delete the old Classic projects once the new app serves traffic.

## Things to verify / follow-ups

- **External SQL proxy** (`https://w3x.io/sql`) is unchanged and still required.
  It's a separate external dependency — confirm it's still alive and not itself
  being retired.
- **`Deno.cron` free-tier limit** is 10 jobs per revision; this app uses 1.
- **`deno bundle`** is stable-enough but still flagged `--unstable-bundle` in
  Deno 2.9; watch for it graduating.
- **Lint debt / JSX:** the client uses the classic JSX pragma (`h`/`Fragment`),
  which trips a few newer `deno lint` rules (false-positive unused `h`, plus
  some genuine dead-code). `deno lint` is therefore not gated in CI. Migrating
  the client to the automatic JSX runtime (`"jsx": "react-jsx"`,
  `"jsxImportSource": "preact"`) would resolve this and drop the per-file `h`
  imports — a good separate cleanup.
- **`metrics.ts`** is currently not imported anywhere. Either wire it up or
  delete it.
