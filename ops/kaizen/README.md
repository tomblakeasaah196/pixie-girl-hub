# Kaizen — deploy artifacts & steps (Phase 0)

Server-side steps to bring Kaizen online at `kaizen.pixiegirlglobal.com`. These
require SSH/root on the Pixie Girl Hub origin box and access to the Cloudflare
zone — they can't be done from CI. Full detail:
`docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md` §10.

## Files here

- `nginx-kaizen.conf` — nginx server block (static SPA + `/api` proxy).
- `RESTORE_RUNBOOK.md` — disaster-recovery procedure (used from Phase 4).

## 1. Cloudflare DNS

In the `pixiegirlglobal.com` zone → DNS → Add record:
- Type `A` (or `CNAME`), Name `kaizen`, value = the same origin the ERP/admin
  uses, Proxy status **Proxied** (orange cloud). SSL/TLS mode **Full (strict)**.
- Optional: add a **Cloudflare Access** policy limiting the host to JBS Praxis
  emails (a second lock in front of the app login).

## 2. Backend env

Add to the backend `.env` (see `.env.example` for the block) and restart the API:

```
KAIZEN_JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
KAIZEN_BASE_URL=https://kaizen.pixiegirlglobal.com
KAIZEN_COOKIE_DOMAIN=            # optional, e.g. .pixiegirlglobal.com
```

The main API boots fine without these; only Kaizen's auth path needs them.

## 3. Migrate + seed the first operator

```bash
npm run db:migrate:shared     # applies 000301_shared_kaizen_operators.sql
KAIZEN_ADMIN_EMAIL=tom.asaah@jbspraxis.com \
KAIZEN_ADMIN_NAME="Tom Asaah" \
KAIZEN_ADMIN_PHONE=09020868023 \
node scripts/kaizen-create-operator.js      # prompts for the password (not committed)
pm2 restart pixie-girl-hub
```

The operator is created with `must_change_password` — you'll rotate it on first
login.

## 4. Build the frontend + wire nginx

```bash
cd apps/kaizen && npm install && npm run build   # → apps/kaizen/dist
sudo cp ops/kaizen/nginx-kaizen.conf /etc/nginx/sites-available/kaizen.conf
sudo ln -sf /etc/nginx/sites-available/kaizen.conf /etc/nginx/sites-enabled/kaizen.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Verify

- `https://kaizen.pixiegirlglobal.com` serves the login screen.
- Sign in as Tom → forced password change → Overview shows the API online.
- Invite a teammate by email (or copy the returned link) and accept it.

Later phases add errors, health, performance, backups (rclone/restic) and
alerts — plus the system-level `rclone`/`restic`/cron/sudoers setup in §10.4 of
the guide.
