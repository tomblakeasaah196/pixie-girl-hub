#!/usr/bin/env bash
# ============================================================================
# Kaizen full-volume backup wrapper — runs as ROOT via a sudoers NOPASSWD rule.
# Installed at /usr/local/bin/kaizen-fullbackup (chmod 750, root-owned).
#
# Node cannot image a live disk, so this wrapper does the actual restic backup
# (encrypted, deduplicated, incremental) of the whole server volume, prunes to
# the retention policy (7 daily / 4 weekly / 6 monthly — the locked decision),
# and writes a machine-readable status file the Kaizen worker reads back.
#
# Deploy: see docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md §10.4.
# ============================================================================
set -euo pipefail

export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-rclone:gdrive:pixiegirl-hub/restic}"
# Password from a root-only file (chmod 600), NOT the environment or the repo.
export RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/root/.kaizen/restic.pass}"

# CRITICAL: restic runs as ROOT but the rclone 'gdrive' remote is configured
# under the app user's home. Point rclone at that config so root can reach the
# remote — otherwise the first restic call fails instantly with
# "didn't find section in config file (gdrive)". Adjust the path if your app
# user isn't 'administrator'.
export RCLONE_CONFIG="${RCLONE_CONFIG:-/home/administrator/.config/rclone/rclone.conf}"

STATUS="${KAIZEN_RESTIC_STATUS_JSON:-/var/backups/kaizen/last-full.json}"
LOG="/var/log/kaizen-fullbackup.log"
mkdir -p "$(dirname "$STATUS")"

start=$(date +%s)

if restic backup / \
     --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/run \
     --exclude=/tmp --exclude=/var/backups/kaizen/staging \
     --exclude='**/node_modules' \
     --json >>"$LOG" 2>&1; then
  # Retention: 7 daily / 4 weekly / 6 monthly, then prune unreferenced data.
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune >>"$LOG" 2>&1 || true
  dur=$(( $(date +%s) - start ))
  printf '{"status":"success","duration_s":%s,"finished":"%s"}\n' \
    "$dur" "$(date -Iseconds)" > "$STATUS"
  exit 0
else
  dur=$(( $(date +%s) - start ))
  printf '{"status":"failed","duration_s":%s,"finished":"%s"}\n' \
    "$dur" "$(date -Iseconds)" > "$STATUS"
  exit 1
fi
