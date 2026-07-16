# Deploying blocktol on the EC2 cohost

Blocktol runs as a long-lived Deno process on the same EC2 box as the MariaDB +
`/sql` proxy (and emoji-sheep-tag / w3xio / others), behind nginx + certbot, and
auto-deploys on merge to `prod` via w3xio's `/deploy` webhook.

- **Serving:** `blocktol.service` (systemd) runs `deno task start` on a local
  port; nginx (`blocktol.nginx.conf`) terminates TLS and reverse-proxies to it.
- **Deploy:** merge to `prod` → CI passes → `.github/workflows/deploy.yml` POSTs
  `{app:"blocktol", version:<sha>}` to w3xio's `/deploy`, which does
  `git fetch origin prod` → `git checkout <sha>` → `deno task build` →
  `systemctl restart blocktol`.
- **DB:** the app talks to the co-located `/sql` proxy over localhost via
  `SQL_PROXY_URL` (no proxy semantics change). A later step can switch to a
  direct `mysql2` connection.

`deploy/blocktol.service` and `deploy/blocktol.nginx.conf` are **reference
templates** — nothing reads them live. The authoritative files are
`/etc/systemd/system/blocktol.service` and
`/etc/nginx/sites-enabled/blocktol.conf`, copied from these; keep them in sync.

## Box facts (this cohost)

- Service account `ubuntu`, home `/home/ubuntu`, checkout
  `/home/ubuntu/blocktol`.
- deno binary: `/home/ubuntu/.deno/bin/deno`.
- **Port 3040** (free). Do NOT reuse the occupied ports: 3017 (st2mr), 3020
  (w3xio/dapi), 3030 (emoji-sheep-tag / est.w3x.io), 3626 (w3x.io main + the
  `/sql` proxy), 3627 (katma).
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
   ```

   Telemetry (traces + logs) is env-configured via the OTel vars — see the
   Observability section of the top-level `CLAUDE.md`; those go in this same
   file on the co-located instance. `SQL_PASSWORD` is the password of the MySQL
   user named after the database (`blocktol-prod`) — the **same secret Deno
   Deploy prod uses**, NOT a shared/ global one (reusing w3xio's yields
   `Access denied for 'blocktol-prod'`). The `blocktol-dev`/`-prod`/`-local`
   databases already exist.

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

5. **nginx.** Install `deploy/blocktol.nginx.conf` as
   `/etc/nginx/sites-enabled/blocktol.conf`, then
   `sudo nginx -t &&
   sudo systemctl reload nginx`. TLS is the next step.

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

## Operating

- Logs: `journalctl -u blocktol -f`
- Manual restart: `sudo systemctl restart blocktol` (uses the assets already on
  disk — a full redeploy rebuilds them)
- Rollback:
  `git -C /home/ubuntu/blocktol checkout <old-sha> && deno task build &&
  sudo systemctl restart blocktol`
- A failed deploy pings the admin Discord channel (via w3xio) with the
  `journalctl` tail.
