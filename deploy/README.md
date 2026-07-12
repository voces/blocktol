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
   NEW_RELIC_API_KEY=...
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=...
   ```
   `SQL_PASSWORD` is the password of the MySQL user named after the database
   (`blocktol-prod`) — the **same secret Deno Deploy prod uses**, NOT a shared/
   global one (reusing w3xio's yields `Access denied for 'blocktol-prod'`). The
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

5. **nginx.** Install `deploy/blocktol.nginx.conf` as
   `/etc/nginx/sites-enabled/blocktol.conf`, then
   `sudo nginx -t &&
   sudo systemctl reload nginx`. TLS is the next step.

6. **TLS (zero-downtime for a live domain).** `certbot --nginx` uses HTTP-01,
   which needs DNS already pointing at this box — a chicken-and-egg that forces
   a TLS gap when migrating `blocktol.com` off Deno Deploy. Instead **pre-issue
   via DNS-01 before repointing DNS**:
   ```bash
   sudo certbot certonly --manual --preferred-challenges dns \
     -d blocktol.com -d www.blocktol.com
   # add the printed _acme-challenge TXT record(s), wait for propagation
   ```
   Wire the issued cert into the vhost (or let the reissue below do it), cut DNS
   over (step 8), then reissue through nginx to get auto-renewal:
   ```bash
   sudo certbot --nginx -d blocktol.com -d www.blocktol.com
   ```

7. **w3xio config.** Set `BLOCKTOL_DIR=/home/ubuntu/blocktol` in w3xio's
   environment (its `/deploy` default is `/home/verit/blocktol`). The existing
   `DEPLOY_SECRET` is reused.

8. **GitHub secret + DNS.** Set the blocktol repo's `DEPLOY_WEBHOOK_URL` secret
   to `https://w3x.io/deploy?token=<DEPLOY_SECRET>` (merges to `prod` then
   deploy automatically), and point `blocktol.com` / `www.blocktol.com` at the
   EC2's IP.

## Cutover

With the service healthy and the cert pre-issued:

1. Repoint `blocktol.com` DNS from Deno Deploy to the EC2.
2. Reissue with `certbot --nginx` (step 6) for auto-renewal.
3. **Disconnect the Deno Deploy GitHub integration** (app.deno.com) so the two
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
