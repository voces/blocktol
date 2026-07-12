# Deploying blocktol on the EC2 cohost

Blocktol runs as a long-lived Deno process on the same EC2 box as the MariaDB +
`/sql` proxy (and emoji-sheep-tag / w3xio), behind nginx + certbot, and
auto-deploys on merge to `prod` via w3xio's `/deploy` webhook.

- **Serving:** `blocktol.service` (systemd) runs `deno task start` on a local
  port; nginx (`blocktol.nginx.conf`) terminates TLS and reverse-proxies to it.
- **Deploy:** merge to `prod` → CI passes → `.github/workflows/deploy.yml` POSTs
  `{app:"blocktol", version:<sha>}` to w3xio's `/deploy`, which does
  `git fetch origin prod` → `git checkout <sha>` → `deno task build` →
  `systemctl restart blocktol`.
- **DB:** the app talks to the existing `/sql` proxy over localhost via
  `SQL_PROXY_URL` (no proxy semantics change). A later step can switch to a
  direct `mysql2` connection.

The repo-side pieces (this `deploy/` dir, `deploy.yml`, and the w3xio `/deploy`
change) are safe to merge before any of the below — `deploy.yml` no-ops until
the webhook secret exists, and Deno Deploy keeps serving until you cut DNS over.

## One-time box setup

1. **Clone + build.** As the service user (the unit assumes `verit`; adjust
   `User=`, `WorkingDirectory=`, and paths if different):
   ```bash
   git clone https://github.com/voces/blocktol /home/verit/blocktol
   cd /home/verit/blocktol && git checkout prod
   deno task build            # generates public/js/*, which is gitignored
   ```

2. **Env file** `/home/verit/blocktol/.env` (chmod 600):
   ```
   PORT=3030
   APP_ENV=prod
   SQL_PASSWORD=...
   SQL_PROXY_URL=http://127.0.0.1:<proxy-port>/sql   # the local /sql proxy
   NEW_RELIC_API_KEY=...
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=...
   ```
   Pick a `PORT` not already used (w3xio uses 3020); keep it in sync with the
   nginx `proxy_pass` port.

3. **systemd service.** Copy `deploy/blocktol.service` to
   `/etc/systemd/system/blocktol.service`, fix the `ExecStart` deno path
   (`which deno`), then:
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

5. **nginx + TLS.** Install `deploy/blocktol.nginx.conf` (adjust `server_name` +
   port), then:
   ```bash
   sudo certbot --nginx -d blocktol.com
   sudo nginx -t && sudo systemctl reload nginx
   ```

6. **DNS.** Point `blocktol.com` at the EC2's IP.

7. **w3xio config.** If blocktol's checkout isn't at the default
   `/home/verit/blocktol`, set `BLOCKTOL_DIR` in w3xio's environment. The
   existing `DEPLOY_SECRET` is reused.

8. **GitHub secret.** In the blocktol repo, set `DEPLOY_WEBHOOK_URL` to
   `https://w3x.io/deploy?token=<DEPLOY_SECRET>`. Once set, merges to `prod`
   deploy automatically.

## Cutover

With the service healthy and reachable on the new hostname:

1. Migrate DNS for the production domain from Deno Deploy to the EC2 (or launch
   on the new hostname first and repoint when confident).
2. **Disconnect the Deno Deploy GitHub integration** (app.deno.com) so the two
   don't both deploy on push to `prod`.
3. Update `.github/workflows/ci.yml`'s deployment note.

## Operating

- Logs: `journalctl -u blocktol -f`
- Manual restart: `sudo systemctl restart blocktol` (uses the assets already on
  disk — a full redeploy rebuilds them)
- Rollback:
  `git -C /home/verit/blocktol checkout <old-sha> && deno task build &&
  sudo systemctl restart blocktol`
- A failed deploy pings the admin Discord channel (via w3xio) with the
  `journalctl` tail.
