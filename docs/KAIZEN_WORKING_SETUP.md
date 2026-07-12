# Kaizen — Working Setup (server-side, excluding CI/deploy)

Do these on the VPS after the code is deployed. Order matters. Steps 1–5 give a
working console (login + errors + health + perf). Steps 6–9 add working backups.

---

## 1. Backend env (`/var/www/pixie-girl-hub/.env`)

Minimum to make Kaizen auth work (the API 503s the Kaizen login path without the secret):

```bash
KAIZEN_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
KAIZEN_BASE_URL=https://kaizen.pixiegirlglobal.com
# optional: host-only cookie unless you set a domain
KAIZEN_COOKIE_DOMAIN=
```

Phase 1 — frontend error ingest (so client apps can report crashes):

```bash
KAIZEN_INGEST_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
KAIZEN_INGEST_ALLOWED_ORIGINS=https://hub.pixiegirlglobal.com,https://kaizen.pixiegirlglobal.com
KAIZEN_CAPTURE_4XX=false
```

Phase 3 — backups (fill after step 6; needed before backups run):

```bash
KAIZEN_BACKUP_STAGING_DIR=/var/backups/kaizen/staging
KAIZEN_LOCAL_BACKUP_DIR=/var/backups/kaizen/local
KAIZEN_PGDUMP_BIN=/usr/bin/pg_dump
KAIZEN_PGRESTORE_BIN=/usr/bin/pg_restore
KAIZEN_RCLONE_BIN=/usr/bin/rclone
KAIZEN_RCLONE_REMOTE=gdrive-crypt:
KAIZEN_RCLONE_PATH_PREFIX=pixiegirl-hub/backups
KAIZEN_RESTIC_BIN=/usr/bin/restic
KAIZEN_RESTIC_REPOSITORY=rclone:gdrive:pixiegirl-hub/restic
KAIZEN_RESTIC_PASSWORD=<strong-password>          # also in your password manager
KAIZEN_RESTIC_STATUS_JSON=/var/backups/kaizen/last-full.json
KAIZEN_FULLBACKUP_CMD=/usr/local/bin/kaizen-fullbackup
KAIZEN_SCRATCH_DB=kaizen_restore_scratch
```

## 2. Migrations

Applies `000301` (operators) + `000319`–`000322` (errors, health/perf, backups, alerts).
All are idempotent (`IF NOT EXISTS`), so re-running is safe.

```bash
cd /var/www/pixie-girl-hub
npm run db:migrate:shared
```

## 3. Seed the first operator (login account)

```bash
KAIZEN_ADMIN_EMAIL=tom.asaah@jbspraxis.com \
KAIZEN_ADMIN_NAME="Tom Asaah" \
KAIZEN_ADMIN_PHONE=09020868023 \
node scripts/kaizen-create-operator.js
# prompts for a password (min 8, 1 uppercase, 1 digit); you rotate it on first login
```

## 4. Restart API + worker (pick up env + schedulers)

```bash
pm2 restart pixie-girl-hub          # API
pm2 restart <worker process>        # worker (or your ENABLE_WORKERS path)
pm2 logs --lines 30                 # confirm no boot errors; crons registered
```

## 5. Build the frontend + serve it

```bash
cd apps/kaizen && npm install && npm run build      # → apps/kaizen/dist
# nginx: serve dist + proxy /api,/media,/socket.io → 127.0.0.1:7000
sudo cp ops/kaizen/nginx-kaizen.conf /etc/nginx/sites-available/kaizen.conf
sudo ln -sf /etc/nginx/sites-available/kaizen.conf /etc/nginx/sites-enabled/kaizen.conf
sudo nginx -t && sudo systemctl reload nginx
```

If you use a hosting panel (CyberPanel etc.): keep exactly ONE `root` — either the
panel's `{{root}}` macro OR the explicit `.../apps/kaizen/dist`, not both (see the
note in `ops/kaizen/nginx-kaizen.conf`). Point the site's document root at
`/var/www/pixie-girl-hub/apps/kaizen/dist`.

Also set the frontend build-time env (before `npm run build`) so Kaizen's own
crashes report:

```bash
# apps/kaizen/.env
VITE_KAIZEN_INGEST_URL=https://kaizen.pixiegirlglobal.com/api/v1/kaizen/ingest/client-error
VITE_KAIZEN_INGEST_KEY=<same as backend KAIZEN_INGEST_KEY>
```

**At this point Kaizen works:** open `https://kaizen.pixiegirlglobal.com`, log in as
Tom → forced password change → Overview shows API online, and Errors / Health /
Performance are live.

---

## 6. Backup tooling (one-time, as root)

```bash
# install tools (match your PG major)
curl https://rclone.org/install.sh | sudo bash
sudo apt-get install -y restic postgresql-client-16

# configure rclone remotes (interactive)
rclone config
#  → gdrive        : Google Drive (Tom's 2TB account; use `rclone authorize "drive"` on a desktop for headless)
#  → gdrive-crypt  : crypt over gdrive:pixiegirl-hub/backups   (encrypt names + data)
rclone about gdrive:          # sanity: shows free space
rclone mkdir gdrive-crypt:

# init the restic repo (full-volume)
export RESTIC_REPOSITORY="rclone:gdrive:pixiegirl-hub/restic"
export RESTIC_PASSWORD="<same as KAIZEN_RESTIC_PASSWORD>"
restic init

# root wrapper + password file + sudoers (least-privilege)
sudo install -m750 -o root -g root ops/kaizen/kaizen-fullbackup.sh /usr/local/bin/kaizen-fullbackup
sudo mkdir -p /root/.kaizen && printf '%s' "$RESTIC_PASSWORD" | sudo tee /root/.kaizen/restic.pass >/dev/null && sudo chmod 600 /root/.kaizen/restic.pass
sudo cp ops/kaizen/sudoers-kaizen /etc/sudoers.d/kaizen   # edit 'appuser' → the user your worker runs as
sudo visudo -cf /etc/sudoers.d/kaizen                     # must say "parsed OK"
sudo mkdir -p /var/backups/kaizen/staging /var/backups/kaizen/local
```

## 7. Verify the backup stack

```bash
node scripts/kaizen-setup-check.js      # expect all green: rclone, restic, pg_dump, remote, repo, sudoers, staging
```

## 8. Create the default backup destination (one API call)

Log in to Kaizen in the browser, or use the token. Example with the operator token:

```bash
curl -X POST https://kaizen.pixiegirlglobal.com/api/v1/kaizen/backups/destinations \
  -H "Authorization: Bearer <operator-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Google Drive (Tom)","kind":"rclone","rclone_remote":"gdrive-crypt:","path_prefix":"pixiegirl-hub/backups","is_default":true}'
```

## 9. Prove it works (seed the dashboards)

In Kaizen → Backups:
1. **Run logical now** → wait → the run shows `success` with size/duration/checksum.
2. **Run drill now** → the verified-restore badge appears with a measured time.

Scheduled from now on (worker, Africa/Lagos): logical 02:30, full-volume 03:00,
restore drill Sun 04:00, health snapshot every minute, maintenance/alerts hourly.

---

## Cloudflare (if not already done as part of deploy)

- DNS: `kaizen` A/CNAME → the origin IP the admin app uses, **Proxied**, SSL/TLS Full (strict).
- Access policy: restrict to `@jbspraxis.com` emails, **but add a bypass/service-token
  for `kaizen.pixiegirlglobal.com/api/v1/kaizen/ingest/*`** so client apps can post
  error reports without a human Access login.

## Quick "is it working?" checklist

- [ ] `curl -I https://kaizen.pixiegirlglobal.com/health` → 200
- [ ] Login → forced password change → Overview shows system OK
- [ ] Errors page loads (empty is fine); trigger a test 500 and see it grouped
- [ ] Health tiles green; Performance shows p95 after some traffic
- [ ] `kaizen-setup-check.js` all green
- [ ] Manual logical backup → success; restore drill → pass badge

## Recovery-SLA honesty

Don't quote a recovery time to the client until a restore drill (or a full Path-C
rehearsal per `ops/kaizen/RESTORE_RUNBOOK.md`) has actually **measured** it.
