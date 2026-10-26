# Deploying blocktol on the EC2 cohost

Blocktol runs as a long-lived Node process on the same EC2 box as the MariaDB +
`/sql` proxy (and emoji-sheep-tag / w3xio / others), behind nginx + certbot, and
auto-deploys on merge to `prod` via w3xio's `/deploy` webhook.

- **Serving:** `blocktol.service` (systemd) runs `deno task start`, which runs
  `node server/index.ts`, on a local port; nginx (`blocktol.nginx.conf`)
  terminates TLS, gzips text responses, rate-limits `/api/` per IP, and
  reverse-proxies to it.
- **Deploy:** merge to `prod` → CI passes → `.github/workflows/deploy.yml` POSTs
  `{app:"blocktol", version:<sha>}` to w3xio's `/deploy`, which does
  `git fetch origin prod` → `git checkout <sha>` → `./deploy/build` (read from
  that commit, so a change to the build ships with the code that needs it) →
  `systemctl restart blocktol`.
- **DB:** the app talks to the co-located `/sql` proxy over localhost via
  `SQL_PROXY_URL` (no proxy semantics change). A later step can switch to a
  direct `mysql2` connection.

`deploy/blocktol.service`, `deploy/blocktol.nginx.conf`,
`deploy/blocktol-ratelimit.conf` and `deploy/blocktol-trace.conf` are
**reference templates** — nothing reads them live. The authoritative files are
`/etc/systemd/system/blocktol.service`,
`/etc/nginx/sites-enabled/blocktol.conf`,
`/etc/nginx/conf.d/blocktol-ratelimit.conf` and
`/etc/nginx/conf.d/blocktol-trace.conf`, copied from these; keep them in sync.
The same holds for the box-level backup and journald files described under
[Backups](#backups).

## Box facts (this cohost)

- Service account `ubuntu`, home `/home/ubuntu`, checkout
  `/home/ubuntu/blocktol`.
- deno binary: `/home/ubuntu/.deno/bin/deno` (tasks, installs and the client
  build).
- node binary: Node 24 at `/usr/bin/node`, on systemd's default `PATH`; it runs
  the server. Check with `node --version`.
- **Port 3040** (prod) and **3041** (the dev instance). Do NOT reuse the
  occupied ports: 3017 (st2mr), 3020 (w3xio/dapi), 3030 (emoji-sheep-tag /
  est.w3x.io), 3626 (w3x.io main + the `/sql` proxy), 3627 (katma).
- The `/sql` proxy is co-located, reachable locally at
  `http://127.0.0.1:3626/sql` (w3x.io's nginx `location /` proxies to 3626).

## One-time box setup

1. **Clone + build** as `ubuntu`:
   ```bash
   git clone https://github.com/voces/blocktol /home/ubuntu/blocktol
   cd /home/ubuntu/blocktol && git checkout prod
   ./deploy/build             # node_modules/ and public/js/*, both gitignored
   ```

2. **Env file** `/home/ubuntu/blocktol/.env` (chmod 600; `.env` is gitignored):
   ```
   PORT=3040
   APP_ENV=prod
   SQL_PASSWORD=...
   SQL_PROXY_URL=http://127.0.0.1:3626/sql
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=...
   DISCORD_ADMIN_WEBHOOK_URL=...
   DISCORD_RESULTS_WEBHOOK_URL=...
   ```

   Every one of these fails silently when missing: no push without the VAPID
   keys, no operator alerts without `DISCORD_ADMIN_WEBHOOK_URL` (and no off-box
   record of deletions, see Backups), and results posts fall back to the admin
   channel without `DISCORD_RESULTS_WEBHOOK_URL`. Check them after any rebuild
   of the box (see Alerts for a test).

   Telemetry (traces + logs) is env-configured via the OTel vars — see the
   Observability section of the top-level `CLAUDE.md`; those go in this same
   file on the co-located instance. `SQL_PASSWORD` is the password of the MySQL
   user named after the database (`blocktol-prod`), NOT a shared/global one
   (reusing w3xio's yields `Access denied for 'blocktol-prod'`). The
   `blocktol-dev`/`-prod`/`-local` databases already exist.

3. **systemd service.** Copy `deploy/blocktol.service` to
   `/etc/systemd/system/blocktol.service`, then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now blocktol
   sudo systemctl status blocktol      # confirm active
   ```

4. **sudoers** — let the w3xio deploy process restart the unit without a
   password (mirror the emojist rule). As the user w3xio runs under:
   ```
   <w3xio-user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart blocktol
   ```
   Also ensure `deno` is on that process's `PATH` (`deploy/build` runs
   `deno install` and `deno task build`).

5. **nginx.** Install `deploy/blocktol-ratelimit.conf` as
   `/etc/nginx/conf.d/blocktol-ratelimit.conf` (the API rate-limit zone) and
   `deploy/blocktol-trace.conf` as `/etc/nginx/conf.d/blocktol-trace.conf` (the
   trace-id map and access-log format) — both must live in the `http` context —
   and `deploy/blocktol.nginx.conf` as `/etc/nginx/sites-enabled/blocktol.conf`,
   then `sudo nginx -t && sudo systemctl reload nginx`. TLS is the next step.

   Once certbot has edited the live vhost, don't copy the template over it (that
   drops the 443 listener and certs) — merge changes into the existing `server`
   block by hand, then run the same `nginx -t` + reload.

6. **TLS.** With `blocktol.com`'s `A` record pointing at this box (IPv4 only: no
   `AAAA`, or dual-stack clients miss it), issue and install the cert:
   ```bash
   sudo certbot --nginx -d blocktol.com
   ```
   certbot adds the 443 listener and redirect to the vhost and renews on its
   own.

7. **w3xio config.** Set `BLOCKTOL_DIR=/home/ubuntu/blocktol` in w3xio's
   environment (its `/deploy` default is `/home/verit/blocktol`). The existing
   `DEPLOY_SECRET` is reused.

8. **GitHub secret.** Set the blocktol repo's `DEPLOY_WEBHOOK_URL` secret to
   `https://dapi.w3x.io/deploy?token=<DEPLOY_SECRET>` — merges to `prod` then
   deploy automatically.

## Dev instance

A second, long-lived instance on this box serves `dev.blocktol.com` against the
`blocktol-dev` database. `.github/workflows/deploy-dev.yml` deploys to it (→
w3xio's `/deploy` with `app:"blocktol-dev"`, whose entry in w3xio's
`src/api/routes/deploy.ts` fetches, checks out the commit, runs its
`deploy/build` and restarts `blocktol-dev`), and its boot applies the deployed
commit's pending migrations to `blocktol-dev`. A commit gets there two ways:

- **`prod`'s tip, automatically**, on the same trigger that deploys it to prod.
  This is dev's resting state.
- **A PR's head, only when a person approves it.** Every PR's run has a `pr` job
  that waits on the `dev` environment's required reviewer; approve it (the run
  page → Review deployments) to put that commit on dev. A newer push to the PR
  replaces its waiting job. A push alone never deploys and never migrates dev.

It is **one** instance: dev runs whichever of the two deployed last, and the
next merge returns it to `prod`'s tip. A migration from an approved PR that is
later dropped stays applied to `blocktol-dev` (`server/db/CLAUDE.md`), so
approve a PR carrying a migration only when that is acceptable. A branch cut
from `prod` before `deploy/build` existed fails its deploy at the build step
until it merges `prod` in.

It runs both crons (`DISABLE_CRONS` unset): it is the only long-lived writer on
`blocktol-dev`, so dev gets its dailies generated and rated on schedule.

- **Checkout:** `/home/ubuntu/blocktol-dev` (detached at the deployed commit).
- **Unit:** `blocktol-dev.service` (template `deploy/blocktol-dev.service`),
  port 3041, journal tag `blocktol-dev`.
- **Vhost:** `/etc/nginx/sites-enabled/blocktol-dev.conf` (template
  `deploy/blocktol-dev.nginx.conf`), its own rate-limit zone `blocktol_dev_api`
  (in `blocktol-ratelimit.conf`), `X-Robots-Tag: noindex`.
- **Deploy:** w3xio's `blocktol-dev` app (checkout from `BLOCKTOL_DEV_DIR`,
  default `/home/ubuntu/blocktol-dev`). w3xio runs one deploy per app at a time,
  so an approved PR and a merge landing together don't interleave.

Setup, in order:

1. **Preconditions.** Confirm port 3041 is free (`ss -ltn | grep 3041` prints
   nothing). Add a DNS `A` record `dev.blocktol.com` → this box (IPv4 only, no
   `AAAA`, as for the apex); certbot's HTTP-01 check in step 6 needs it
   resolving.

2. **Clone + build** as `ubuntu`:
   ```bash
   git clone https://github.com/voces/blocktol /home/ubuntu/blocktol-dev
   cd /home/ubuntu/blocktol-dev && git checkout --detach origin/prod
   ./deploy/build             # what each deploy runs; generates public/js/*
   ```

3. **Env file** `/home/ubuntu/blocktol-dev/.env` (chmod 600):
   ```
   PORT=3041
   APP_ENV=dev
   SQL_PASSWORD=...          # the blocktol-dev MySQL user's, not prod's
   SQL_PROXY_URL=http://127.0.0.1:3626/sql
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=...
   DISCORD_ADMIN_WEBHOOK_URL=...
   ```
   - **VAPID:** reuse the pair dev already has (from the existing `.env`, or
     wherever its secrets are kept), so the `push_subscription` rows on
     `blocktol-dev` keep working; a new pair silently invalidates them (see
     `server/CLAUDE.md`, Environment variables).
   - **Discord:** never prod's `DISCORD_RESULTS_WEBHOOK_URL` — dev's crons post
     daily results, and players would see them. Use a dev channel's webhook as
     `DISCORD_ADMIN_WEBHOOK_URL` (results fall back to it, footer-tagged
     `blocktol:dev`), or leave both unset to make the posts no-ops.
   - **Telemetry** (optional): the same OTel vars as prod with
     `OTEL_SERVICE_NAME=blocktol-dev`, so dev's traces and logs don't mix with
     prod's.

4. **systemd.** Copy `deploy/blocktol-dev.service` to
   `/etc/systemd/system/blocktol-dev.service`, then
   `sudo systemctl daemon-reload && sudo systemctl enable --now blocktol-dev`.
   `journalctl -u blocktol-dev -n 20` shows `listening` with port 3041.

5. **Checkout access + sudoers.** w3xio runs the dev deploy as the same user as
   prod's, so give that user write access to `/home/ubuntu/blocktol-dev` the
   same way prod's checkout is, and add beside prod's rule:
   ```
   <w3xio-user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart blocktol-dev
   ```

6. **nginx + TLS.** Install the updated `deploy/blocktol-ratelimit.conf` over
   `/etc/nginx/conf.d/blocktol-ratelimit.conf` (it adds the dev zone) and
   `deploy/blocktol-dev.nginx.conf` as
   `/etc/nginx/sites-enabled/blocktol-dev.conf`, then
   `sudo nginx -t && sudo systemctl reload nginx` and
   `sudo certbot --nginx -d dev.blocktol.com`.

7. **w3xio.** Deploy the w3xio version that knows the `blocktol-dev` app, and
   set `BLOCKTOL_DEV_DIR` in its environment if the checkout isn't at the
   default. It reuses the same `DEPLOY_SECRET` and webhook URL; prod's handling
   is unchanged. A failed dev deploy is reported to the admin channel the same
   way as prod's.

8. **Verify by hand**: send the webhook what the workflow will, with prod's
   current tip:
   ```bash
   SHA=$(git -C /home/ubuntu/blocktol-dev rev-parse origin/prod)
   curl -sf -X POST "https://dapi.w3x.io/deploy?token=<DEPLOY_SECRET>" \
     -H "Content-Type: application/json" \
     -d "{\"app\": \"blocktol-dev\", \"version\": \"$SHA\"}"
   ```
   (it answers once the restart is confirmed), then
   `curl -sS https://dev.blocktol.com/health` (200) and
   `curl -sSI https://dev.blocktol.com/ | grep -i x-robots-tag`.

9. **GitHub environment.** Settings → Environments → New environment `dev`;
   under Deployment protection rules tick **Required reviewers** and add
   yourself (leave "Prevent self-review" off, so you can approve your own PRs).
   This is what makes a PR's deploy wait; without it every PR push deploys.

10. **Turn it on.** Set the repository variable `DEV_DEPLOY` to `true` (GitHub →
    Settings → Secrets and variables → Actions → Variables). Then check both
    paths: on an open PR, approve its waiting Deploy dev job, and after the next
    merge, confirm the `prod-tip` job ran; each time
    `journalctl -u blocktol-dev` shows the restart at that commit.

## Operating dev

- Logs: `journalctl -u blocktol-dev -f`
- Put a PR on dev: approve its waiting Deploy dev job. Back to `prod`'s tip:
  re-run the latest `prod-tip` job, or wait for the next merge.
- Deploy a commit by hand: the webhook call from setup step 8, with that
  commit's sha.
- Pause dev deploys: set `DEV_DEPLOY` to anything but `true`.

## Backups

Two independent layers, both box-wide (they cover every database on the cohost,
not just blocktol's):

- **EBS snapshots** — a daily AWS-side snapshot policy (configured in the
  console, not on the box) of both volumes: the root volume, which holds
  MariaDB's datadir `/var/lib/mysql`, and the `/data` volume, which holds the
  VictoriaLogs/VictoriaTraces data and the dumps below. A snapshot of the
  running server is crash-consistent, which InnoDB recovers from cleanly here:
  every user table is InnoDB, `innodb_flush_log_at_trx_commit=1` and the
  doublewrite buffer is on. Restores the whole box.
- **Nightly logical dump** — `mariadb-nightly-dump` (+ its `.service`/`.timer`)
  runs `mariadb-dump --all-databases --single-transaction` at 09:15 UTC
  (`Persistent=`, so a missed run fires at next boot) into
  `/data/mariadb-backups/all-<UTC timestamp>.sql.gz` (root-only, `0600`),
  keeping 14 days (`KEEP_DAYS`). It runs as root over the unix socket, so no
  password is stored, and refuses to run unless `/data` is mounted (`/data` is
  `nofail` in fstab; an unmounted `/data` would otherwise fill `/`). Restores
  one database without rolling back the rest. The `/data` snapshots carry the
  dumps off the box too, so the dumps need no separate off-site copy.

Install (as root):

```bash
install -m 750 deploy/mariadb-nightly-dump /usr/local/sbin/mariadb-nightly-dump
install -m 644 deploy/mariadb-nightly-dump.service deploy/mariadb-nightly-dump.timer \
  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mariadb-nightly-dump.timer
systemctl start mariadb-nightly-dump.service   # one run now
journalctl -u mariadb-nightly-dump -n 5        # "wrote /data/mariadb-backups/…"
```

Restore. Do these in order: the deletion list has to be saved first, because a
snapshot restore rolls VictoriaLogs back with `/data`, and the app must be
stopped, or live writes and the rating cron run against half-restored tables.

1. **Save the deletions made since the backup**, off the box. Each
   `deleteAccount` posts `erasure <hash>` to the admin Discord channel (copy
   every hash posted after the backup's date into `erased.txt`), and logs the
   same hash locally; while the box is alive, the log query in
   `scripts/reapplyErasures.ts`'s header gives the same list. Keep the file
   somewhere the restore won't touch (your own machine).
2. **Stop the app:** `sudo systemctl stop blocktol`.
3. **Restore.** From a dump (it carries its own `CREATE DATABASE`/`USE`):

   ```bash
   # one database only — --one-database skips statements for any other
   zcat /data/mariadb-backups/all-<ts>.sql.gz | sudo mariadb --one-database blocktol-prod
   # or every database on the box
   zcat /data/mariadb-backups/all-<ts>.sql.gz | sudo mariadb
   ```

   Or restore volumes from an EBS snapshot in the AWS console.
4. **Re-apply the deletions** with the saved list, before reopening the game:
   dry run, then `--apply` (`scripts/reapplyErasures.ts`; it reaches the
   database through the SQL proxy, so the app needn't be running).
5. **Start the app:** `sudo systemctl start blocktol`.

Restoring over a live database replaces its tables with the dump's; to inspect a
dump first, load it into a scratch MariaDB instance.

Retention is what keeps backups compatible with deletion: a dump lives 14 days,
and a snapshot (default policy, 14 days at most) can carry a dump up to 14 more,
so erased data is out of every backup within about 30 days. The privacy page
states that bound; lengthening either retention means updating it.

**journald** — `journald-size.conf` (installed as
`/etc/systemd/journald.conf.d/size.conf`, then
`systemctl restart systemd-journald`) caps the persistent journal at 500M and 30
days. blocktol's stdout lands there as well as in VictoriaLogs, and the privacy
page promises diagnostics go after about 30 days.

## Alerts

The app posts operator alerts to `DISCORD_ADMIN_WEBHOOK_URL` (a failed
migration, puzzle generation or rating, a stalled rating cron, the run cap, each
erasure's hash). Test the webhook the running app actually has:

```bash
PID=$(systemctl show -p MainPID --value blocktol)
URL=$(sudo cat /proc/$PID/environ | tr '\0' '\n' | sed -n 's/^DISCORD_ADMIN_WEBHOOK_URL=//p')
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' \
  -d '{"content":"blocktol: alert test","allowed_mentions":{"parse":[]}}' "$URL"   # 204
```

Box-level failures can't come from the app. `unit-failure-alert@.service` (+ its
script) posts "<unit> failed" to the same webhook for any unit that sets
`OnFailure=unit-failure-alert@%n.service`; the nightly dump does. Install (as
root):

```bash
install -m 750 deploy/unit-failure-alert /usr/local/sbin/unit-failure-alert
install -m 644 deploy/unit-failure-alert@.service /etc/systemd/system/
systemctl daemon-reload
systemctl start unit-failure-alert@test.service   # posts "test failed"
```

Nothing on the box can report the box itself being down. Point a free external
uptime monitor (UptimeRobot, …) at `https://blocktol.com/health` as a plain HTTP
check: it answers 200 only when the app, the database and puzzle generation all
work (`server/routes/health.ts`), and 503 with the reason otherwise.

## Operating

- Logs: `journalctl -u blocktol -f`
- Manual restart: `sudo systemctl restart blocktol` (uses the assets already on
  disk — a full redeploy rebuilds them)
- Rollback:
  `cd /home/ubuntu/blocktol && git checkout <old-sha> && ./deploy/build &&
  sudo systemctl restart blocktol`
  (the unit runs whichever runtime that commit's `start` task names)
- A failed deploy pings the admin Discord channel (via w3xio) with the
  `journalctl` tail.
