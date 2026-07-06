# Kaizen — Disaster Recovery & Restore Runbook

**Scope:** Pixie Girl Hub production (backend + PostgreSQL + Redis + uploads/media + config), backed up off-site by Kaizen via `rclone` (logical) and `restic` (full-volume).
**Audience:** JBS Praxis engineers performing a restore.
**Companion doc:** `docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md`.

> **Golden rules**
> 1. **Never restore over a live production database** unless you have *first* taken a fresh backup of the current (possibly damaged) state. Prefer restoring to a **new** server.
> 2. **Measure the wall-clock time** of every real restore/rehearsal and record it in Kaizen. Our advertised recovery SLA must equal what we have actually measured — never a guess.
> 3. If anything is ambiguous mid-incident, **stop and call Tom** rather than improvise on production.

---

## 0. Before you touch anything — assess

1. **Declare the scenario.** Which of these are you in?
   - **A. Data corruption / bad data** (DB intact, wrong data) → *logical restore* into a scratch or new DB, then swap. Server itself is fine.
   - **B. DB lost / unrecoverable** (server up, Postgres gone) → *logical restore* onto the same box.
   - **C. Whole server lost** (disk failure, provider incident, box gone) → *full-volume restore* onto a fresh box.
   - **D. Ransomware / compromise** → treat as C, on a **new** box, and **rotate every secret** (see §6) before going live.
2. **Snapshot the current state first** (if the box is reachable): run a manual backup from Kaizen → Backups → *Run now* (logical). Even a partial/damaged snapshot is worth having before you overwrite anything.
3. **Note the target RTO** and start a stopwatch. You will record the total time at the end.
4. **Gather credentials** (from the JBS password manager — never the repo):
   - `rclone` config (or re-authorize on the new box).
   - `RESTIC_REPOSITORY` + `RESTIC_PASSWORD`.
   - `rclone crypt` password.
   - Production `.env` (also recoverable *from* the config backup once you restore it).

---

## 1. Prerequisites on the target box

Whether restoring onto the same box (B) or a fresh one (C/D):

```bash
# OS packages
sudo apt-get update
sudo apt-get install -y postgresql-16 redis-server nginx restic postgresql-client-16 curl
curl https://rclone.org/install.sh | sudo bash

# Node (match .nvmrc — currently the repo pins a version there)
# use your standard node install (nvm/nodesource) to match .nvmrc

# rclone remotes (identical names to production)
rclone config   # recreate: gdrive (Drive, Tom's account) + gdrive-crypt (crypt over gdrive)
rclone about gdrive:      # sanity check auth + free space

# restic env
export RESTIC_REPOSITORY="rclone:gdrive:pixiegirl-hub/restic"
export RESTIC_PASSWORD="<from password manager>"
restic snapshots          # confirm you can see snapshots
```

> If restoring on a **fresh** box, also recreate the app directory root the deploy expects: `/var/www/pixie-girl-hub` (see `ecosystem.config.js`).

---

## 2. Path C/D — Full-volume restore (whole server lost)

This is the fastest route to a complete, working box because it restores OS config, installed state, `/var/www`, uploads, nginx, and `.env` together.

```bash
# 1. List snapshots, pick the target (usually 'latest')
restic snapshots

# 2. Restore. Prefer restoring to a staging path, inspect, then move —
#    restoring straight to / is possible but blunt.
sudo -E restic restore latest --target /restore

# 3. Move restored data into place (adjust to what your snapshot captured)
sudo rsync -a /restore/var/www/pixie-girl-hub/ /var/www/pixie-girl-hub/
sudo rsync -a /restore/etc/nginx/            /etc/nginx/
# uploads/media live under the app root and come with the above rsync

# 4. Restore the database from the logical dump (restic captures files, but a
#    consistent DB is best restored from the pg_dump artifact — see §3).
```

> **Why still do the logical DB restore (§3) even after a full-volume restore?** A file-level snapshot of a *running* Postgres data directory is only crash-consistent, not guaranteed clean. The `pg_dump` logical artifact is the authoritative, consistent copy of the data. Restore files with restic, restore the **database** with §3.

Then continue at §4 (bring services up) and §5 (verify).

---

## 3. Path A/B/C — Logical database restore (authoritative data)

The nightly logical bundle lives (encrypted) at `gdrive-crypt:pixiegirl-hub/backups/logical/YYYY/MM/DD/`. You can find the exact artifact key in **Kaizen → Backups → Runs → (the successful run) → detail**, or list it:

```bash
# 1. List available logical backups and pull the DB dump you want
rclone lsjson gdrive-crypt:pixiegirl-hub/backups/logical --recursive | less
rclone copyto \
  "gdrive-crypt:pixiegirl-hub/backups/logical/2026/07/06/db-<ts>.dump" \
  /restore/db.dump

# 2. Verify checksum against the value recorded in kaizen_backup_runs.checksum
sha256sum /restore/db.dump      # must match the ledger

# 3a. SAFE PATH (recommended): restore into a NEW database, verify, then swap.
sudo -u postgres createdb pixie_restore
pg_restore --no-owner --clean --if-exists \
  -h localhost -U "$DB_USER" -d pixie_restore /restore/db.dump
#    ...verify (see §5)... then repoint the app's DB_NAME to pixie_restore,
#    or rename: stop app -> ALTER DATABASE old RENAME; ALTER DATABASE pixie_restore RENAME TO <prod name>.

# 3b. IN-PLACE (only if you have already snapshotted current state and accept overwrite):
pg_restore --no-owner --clean --if-exists \
  -h localhost -U "$DB_USER" -d "$DB_NAME" /restore/db.dump
```

Restore uploads/media + config from the same dated folder if not already restored by §2:

```bash
rclone copyto "gdrive-crypt:pixiegirl-hub/backups/logical/2026/07/06/uploads-<ts>.tgz" /restore/uploads.tgz
rclone copyto "gdrive-crypt:pixiegirl-hub/backups/logical/2026/07/06/config-<ts>.tgz" /restore/config.tgz
sudo tar -xzf /restore/uploads.tgz -C /var/www/pixie-girl-hub/
sudo tar -xzf /restore/config.tgz -C /restore/config/    # inspect before overwriting live .env
```

> **`.env` handling:** the config artifact contains production secrets. Inspect the restored `.env`; if this is a compromise (Path D), **do not reuse the old secrets** — mint new ones (§6).

---

## 4. Bring services up

```bash
cd /var/www/pixie-girl-hub
npm ci                                  # install backend deps
# (frontends are prebuilt in dist; rebuild only if the artifact is missing)
cd apps/kaizen && npm ci && npm run build && cd ../..
# (repeat build for apps/admin etc. only if their dist is absent)

# Migrations should already match the restored DB. Verify, do not blindly re-run.
npm run db:verify                       # expects 425 tables

pm2 start ecosystem.config.js           # backend + landing + storefront + stylist
pm2 start ecosystem.config.js --only pixie-girl-hub   # if starting selectively
# ensure the worker is running (schedulers + backups):
npm run workers:start                   # or your PM2 worker entry

sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable --now redis-server postgresql
```

---

## 5. Verify before declaring recovery

Run through **all** of these; do not cut DNS until they pass:

- [ ] `npm run db:verify` → **425 tables** across `shared`, `pixiegirl`, `faitlynhair`.
- [ ] `curl -fsS http://127.0.0.1:7000/health` → `{ ok: true }`.
- [ ] `curl -fsS "http://127.0.0.1:7000/health?deep=1"` → db + redis healthy.
- [ ] Log into **admin** and load a data-heavy screen (orders/customers) — data present and correct.
- [ ] Spot-check row counts on canary tables vs. the last restore-drill baseline (`kaizen_restore_drills.restored_row_counts`).
- [ ] Uploads/media load (open a product image / a document).
- [ ] Place a test action through a core flow (e.g. create a draft order) — writes succeed.
- [ ] Kaizen loads at its host, shows health green, and the worker's schedulers are registered (`pm2 logs`).
- [ ] Run a **fresh manual backup** from Kaizen and confirm it succeeds — you must leave production with a working backup.

---

## 6. Cut over & close out

1. **DNS:** in Cloudflare, repoint the affected records (root + `admin`/`kaizen`/`storefront`/`stylist` as needed) to the new box's IP. Keep TTL low during recovery.
2. **TLS:** ensure the origin cert (Cloudflare Origin Cert / wildcard) is present on the new box for all hosts, including `kaizen.pixiegirlglobal.com`.
3. **Secrets rotation (mandatory for Path D, recommended after any exposure):** rotate `JWT_SECRET`, `KAIZEN_JWT_SECRET`, DB password, payment gateway keys, `KAIZEN_INGEST_KEY`, restic/rclone-crypt passwords. Update `.env` and the password manager.
4. **Record the outcome in Kaizen:** total wall-clock recovery time, what was restored (full-volume vs logical), any data-loss window (gap between last backup and incident). Update the advertised recovery SLA to match measured reality.
5. **Post-incident note:** root cause, what we'd change (e.g. tighten backup cadence, add a warm standby if the download dominated the RTO), and file follow-up tickets.

---

## 7. Rehearsal (do this before you ever need it for real)

Do not wait for a disaster to discover a gap. **Rehearse Path C on a throwaway box** at least once, and after any major infra change:

1. Spin up a scratch VM.
2. Run §1 → §5 end-to-end against the latest snapshots.
3. Time it. This measured number is what we may promise the client.
4. Tear down the scratch VM.

The weekly automated **restore drill** (Kaizen → Backups → Restore drills) continuously proves the *logical DB* restores and times it — but a full Path-C rehearsal is the only thing that validates end-to-end server recovery. Do both.

---

## Quick reference

| Scenario | Route |
| --- | --- |
| Bad data, DB intact | §3a into a new DB, verify, swap |
| DB lost, server up | §3 in place (after snapshotting current) |
| Whole server lost | §2 (full-volume) + §3 (authoritative DB) → §4 → §5 → §6 |
| Compromise | as "whole server lost", on a NEW box, **rotate all secrets** (§6.3) |

*Artifacts: `gdrive-crypt:pixiegirl-hub/backups/logical/…` (logical, encrypted) • `rclone:gdrive:pixiegirl-hub/restic` (full-volume, restic-encrypted). Exact keys/checksums are in Kaizen → Backups.*
