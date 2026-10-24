# Deploying blocktol on the EC2 cohost

Blocktol runs as a long-lived Deno process on the same EC2 box as the MariaDB +
`/sql` proxy (and emoji-sheep-tag / w3xio / others), behind nginx + certbot, and
auto-deploys on merge to `prod` via w3xio's `/deploy` webhook.

- **Serving:** `blocktol.service` (systemd) runs `deno task start` on a local
  port; nginx (`blocktol.nginx.conf`) terminates TLS, gzips text responses,
  rate-limits `/api/` per IP, and reverse-proxies to it.
- **Deploy:** merge to `prod` → CI passes → `.github/workflows/deploy.yml` POSTs
  `{app:"blocktol", version:<sha>}` to w3xio's `/deploy`, which does
  `git fetch origin prod` → `git checkout <sha>` → `deno task build` →
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
- deno binary: `/home/ubuntu/.deno/bin/deno`.
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
   deno task build            # generates public/js/*, which is gitignored
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
   Also ensure `deno` is on that process's `PATH` (the deploy build step runs
   `deno task build`).

5. **nginx.** Install `deploy/blocktol-ratelimit.conf` as
   `/etc/nginx/conf.d/blocktol-ratelimit.conf` (the API rate-limit zone) and
   `deploy/blocktol-trace.conf` as `/etc/nginx/conf.d/blocktol-trace.conf` (the
   trace-id map and access-log format) — both must live in the `http` context —
   and `deploy/blocktol.nginx.conf` as `/etc/nginx/sites-enabled/blocktol.conf`,
   then `sudo nginx -t && sudo systemctl reload nginx`. TLS is the next step.

   Once certbot has edited the live vhost, don't copy the template over it (that
   drops the 443 listener and certs) — merge changes into the existing `server`
   block by hand, then run the same `nginx -t` + reload.

6. **TLS (zero-downtime for a live domain).** `certbot --nginx` uses HTTP-01,
   which needs DNS already pointing at this box — a chicken-and-egg that forces
   a TLS gap when migrating `blocktol.com` off Deno Deploy. Pre-issue via DNS-01
   **before** repointing DNS instead, apex only (avoids a second per-name swap
   for `www`):
   ```bash
   sudo certbot certonly --manual --preferred-challenges dns -d blocktol.com
   ```
   The catch on this domain: `_acme-challenge.blocktol.com` is already a CNAME →
   `<id>._acme.deno.net` (Deno's own DNS-01 renewal delegation), and a CNAME
   can't coexist with the TXT certbot wants there. So in the DNS zone (Google
   Cloud DNS / googledomains nameservers):
   1. **Save** the CNAME's target, then **delete** the CNAME.
   2. **Add** the `_acme-challenge.blocktol.com` TXT certbot prints (TTL 60) and
      confirm it resolves: `dig +short TXT _acme-challenge.blocktol.com`.
   3. Press Enter so certbot issues, then **restore** the CNAME so Deno keeps
      renewing until cutover.

   Deno's live cert is unaffected — it renews only ~every 90 days, so the
   few-minute delegation gap is a no-op. The post-cutover reissue (for
   auto-renewal) and dropping the CNAME are in the Cutover section.

7. **w3xio config.** Set `BLOCKTOL_DIR=/home/ubuntu/blocktol` in w3xio's
   environment (its `/deploy` default is `/home/verit/blocktol`). The existing
   `DEPLOY_SECRET` is reused.

8. **GitHub secret.** Set the blocktol repo's `DEPLOY_WEBHOOK_URL` secret to
   `https://dapi.w3x.io/deploy?token=<DEPLOY_SECRET>` — merges to `prod` then
   deploy automatically. (The DNS repoint is the Cutover step.)

## Cutover

With the service healthy and the apex cert pre-issued (step 6):

1. **Lower the apex TTL ahead of time.** Deno's A/AAAA TTL is 14400 (4h); set
   the records to 300 first so the flip takes minutes, not hours.
2. **Repoint `blocktol.com` (apex only) from Deno Deploy to the EC2, and delete
   the AAAA.** The apex has an AAAA (`2602:f70f::1` → Deno) and this EC2 is
   IPv4-only, so leaving it makes dual-stack clients prefer IPv6 and keep
   hitting Deno (a split brain). Point the A record at the EC2 and **delete the
   AAAA** (or point it at an EC2 IPv6 if one is added).
3. **Reissue for auto-renewal, then drop the delegation:**
   ```bash
   sudo certbot --nginx -d blocktol.com
   ```
   then delete the Deno `_acme-challenge.blocktol.com` CNAME permanently.
4. **Disconnect the Deno Deploy GitHub integration** (app.deno.com) so the two
   don't both deploy on push to `prod`.

## Dev instance

A second, long-lived instance on this box serves `dev.blocktol.com` against the
`blocktol-dev` database, replacing the Deno Deploy branch previews (#227). It is
**one** instance, not one per branch: every push to a branch other than `prod`
deploys that commit (`.github/workflows/deploy-dev.yml` → w3xio's `/deploy` with
`app:"blocktol-dev"` → `blocktol-dev-deploy`), so dev runs the most recent push,
and its boot applies that commit's pending migrations to `blocktol-dev` — the
same "a push is a deploy, and a deploy migrates" rule the previews had. A
migration from a branch that is later dropped stays applied, as before
(`server/db/CLAUDE.md`).

Unlike a preview, it runs both crons (`DISABLE_CRONS` unset): it is the only
long-lived writer on `blocktol-dev`, so dev gets its dailies generated and rated
on schedule rather than only on demand.

- **Checkout:** `/home/ubuntu/blocktol-dev` (detached at the deployed commit).
- **Unit:** `blocktol-dev.service` (template `deploy/blocktol-dev.service`),
  port 3041, journal tag `blocktol-dev`.
- **Vhost:** `/etc/nginx/sites-enabled/blocktol-dev.conf` (template
  `deploy/blocktol-dev.nginx.conf`), its own rate-limit zone `blocktol_dev_api`
  (in `blocktol-ratelimit.conf`), `X-Robots-Tag: noindex`.
- **Deploy script:** `/usr/local/bin/blocktol-dev-deploy <sha>` (template
  `deploy/blocktol-dev-deploy`).

Setup, in order:

1. **Preconditions.** Confirm port 3041 is free (`ss -ltn | grep 3041` prints
   nothing). Add a DNS `A` record `dev.blocktol.com` → this box (IPv4 only, no
   `AAAA`, as for the apex); certbot's HTTP-01 check in step 6 needs it
   resolving.

2. **Clone + build** as `ubuntu`:
   ```bash
   git clone https://github.com/voces/blocktol /home/ubuntu/blocktol-dev
   cd /home/ubuntu/blocktol-dev && git checkout --detach origin/prod
   deno task build
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
   - **VAPID:** copy the pair from the Deno Deploy project's dev environment
     (app.deno.com), so the `push_subscription` rows already on `blocktol-dev`
     keep working; a new pair silently invalidates them (see `server/CLAUDE.md`,
     Environment variables).
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

5. **Deploy script + sudoers.** As root:
   ```bash
   install -m 755 deploy/blocktol-dev-deploy /usr/local/bin/blocktol-dev-deploy
   ```
   The script runs as the user that runs prod's deploy, so give it write access
   to `/home/ubuntu/blocktol-dev` the same way prod's checkout is, and add
   beside prod's rule:
   ```
   <w3xio-user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart blocktol-dev
   ```

6. **nginx + TLS.** Install the updated `deploy/blocktol-ratelimit.conf` over
   `/etc/nginx/conf.d/blocktol-ratelimit.conf` (it adds the dev zone) and
   `deploy/blocktol-dev.nginx.conf` as
   `/etc/nginx/sites-enabled/blocktol-dev.conf`, then
   `sudo nginx -t && sudo systemctl reload nginx` and
   `sudo certbot --nginx -d dev.blocktol.com`. A new name has no live traffic,
   so the HTTP-01 flow is fine here (the apex's DNS-01 dance doesn't apply).

7. **w3xio.** Teach `/deploy` the app `blocktol-dev`: for
   `{app:"blocktol-dev", version:<sha>}`, run
   `/usr/local/bin/blocktol-dev-deploy <sha>` and report a non-zero exit the way
   a failed prod deploy is reported. It reuses the same `DEPLOY_SECRET` and
   webhook URL; prod's handling is unchanged.

8. **Verify by hand**, as the deploy user:
   `blocktol-dev-deploy "$(git -C /home/ubuntu/blocktol-dev rev-parse origin/prod)"`,
   then `curl -sS https://dev.blocktol.com/health` (200) and
   `curl -sSI https://dev.blocktol.com/ | grep -i x-robots-tag`.

9. **Turn it on.** Set the repository variable `DEV_DEPLOY` to `true` (GitHub →
   Settings → Secrets and variables → Actions → Variables). Push any branch and
   confirm the Deploy dev run succeeds and `journalctl -u blocktol-dev` shows
   the restart at that commit.

**Retiring the previews.** Until the Deno Deploy integration is disconnected,
each push migrates `blocktol-dev` twice (preview and dev instance); a version
already applied doesn't re-run, so that is harmless. Once the dev instance has
taken a few pushes cleanly, disconnect the integration in app.deno.com, then
finish #227 in the code (the `deploy` block in `deno.jsonc`, the Deploy-only
paths, and the push-is-a-deploy text in the `CLAUDE.md` files).

## Operating dev

- Logs: `journalctl -u blocktol-dev -f`
- Redeploy a commit: `blocktol-dev-deploy <sha>` as the deploy user, or run the
  Deploy dev workflow on a branch (Actions → Deploy dev → Run workflow).
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
  `git -C /home/ubuntu/blocktol checkout <old-sha> && deno task build &&
  sudo systemctl restart blocktol`
- A failed deploy pings the admin Discord channel (via w3xio) with the
  `journalctl` tail.
