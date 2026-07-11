# Kaizen — Build Status & Handover

**Updated:** 2026-07-08 • Phases 0–5 implemented in this repo.
**Reference spec:** `docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md`
**Companion:** `docs/KAIZEN_PHASE0_AUDIT_AND_GAP_PLAN.md`, `docs/KAIZEN_ERROR_REPORTING_ROLLOUT.md`, `ops/kaizen/RESTORE_RUNBOOK.md`

## What's built (all phases)

- **Phase 0 — Foundations.** Separate `kaizen_operators` identity (own JWT + `aud:"kaizen"`), login/refresh/invite/change-password, guarded+audited operator management, `apps/kaizen` SPA (ops theme), nginx block, seed script. *(Was pre-existing; audited & hardened.)*
- **Phase 1 — Errors.** Capture at all four points (API 500s, process-level, worker `failed`, frontend ingest), fingerprint grouping, PII redaction, auto-reopen on regression, browse/resolve/ignore/reopen, Markdown export, `/errors` + detail UI, reusable client reporter + boundary.
- **Phase 2 — Health & performance.** Probes (db/redis/queue/disk/mem/cpu + backup/restore freshness), 1-min health snapshots, perf reservoir → 1-min rollups (self-flush in API), `/health` + `/performance` UI, Overview tiles, `/health?deep=1`.
- **Phase 3 — Backups.** rclone + local transports, logical backup (pg_dump + uploads + config → sha256 → upload → verify → ledger), full-volume cockpit (sudo restic wrapper + status read), `kaizen-backup` queue, 02:30/03:00 schedulers, retention **7/4/6**, `/backups` UI, ops artifacts + `kaizen-setup-check.js`.
- **Phase 4 — Restore drills.** Weekly (Sun 04:00) timed verified restore into an isolated scratch DB with canary assertions, verified-restore badge + drill history UI.
- **Phase 5 — Alerts + polish.** Event-driven + polled alert rules (email + in-dash), dedupe, `/kaizen` Socket.io namespace (Kaizen-JWT auth), hourly maintenance tick (polled rules + occurrence/alert/backup pruning), `/alerts` + `/settings` UI.

## Migrations (note the renumbering)

The repo gained migrations `000305–000318` from concurrent work mid-build, so the Kaizen migrations were renumbered to avoid collisions:

- `000301_shared_kaizen_operators.sql` (Phase 0)
- `000319_shared_kaizen_errors.sql` (Phase 1)
- `000320_shared_kaizen_health_perf.sql` (Phase 2)
- `000321_shared_kaizen_backups.sql` (Phase 3 — also creates `kaizen_restore_drills` + `kaizen_settings`)
- `000322_shared_kaizen_alerts.sql` (Phase 5)

Apply with `npm run db:migrate:shared` (runner keys by full filename).

## New env vars (all optional/defaulted; see `.env.example`)

Auth/ingest: `KAIZEN_JWT_SECRET`, `KAIZEN_INGEST_KEY`, `KAIZEN_INGEST_ALLOWED_ORIGINS`, `KAIZEN_CAPTURE_4XX`.
Backups: `KAIZEN_BACKUP_STAGING_DIR`, `KAIZEN_LOCAL_BACKUP_DIR`, `KAIZEN_PGDUMP_BIN`, `KAIZEN_PGRESTORE_BIN`, `KAIZEN_RCLONE_*`, `KAIZEN_RESTIC_*`, `KAIZEN_FULLBACKUP_CMD`, `KAIZEN_SCRATCH_DB`.

## Deploy checklist (server-side, can't be done from CI)

1. Cloudflare DNS `kaizen` record → **origin IP still needed from Tom** + Cloudflare Access (JBS emails; **bypass `/api/v1/kaizen/ingest/*`**).
2. `.env`: set `KAIZEN_JWT_SECRET`, `KAIZEN_INGEST_KEY` (+ origins), backup/restic vars.
3. `npm run db:migrate:shared` → `node scripts/kaizen-create-operator.js` → restart API + worker.
4. `cd apps/kaizen && npm install && npm run build`; wire nginx (`ops/kaizen/nginx-kaizen.conf` — mind the panel `{{root}}` duplicate-root gotcha noted in the file).
5. Backups infra (§10.4): install rclone/restic/postgresql-client-16; `rclone config` (gdrive + gdrive-crypt); `restic init`; install `kaizen-fullbackup.sh` + `sudoers-kaizen`; `node scripts/kaizen-setup-check.js` → all green.
6. Create a default backup destination (POST `/api/v1/kaizen/backups/destinations`).
7. Run a manual logical backup, then a restore drill, to seed the "last success" + "verified restore" badges. **Do not quote a recovery SLA until a drill (or full Path-C rehearsal) measures it.**

## Verification status / caveats

- **Backend:** every Kaizen `.js` passes `node --check`; module require-chains and pure logic (fingerprint, redaction, markdown, perf percentiles, rclone paths, alert bus, realtime no-op) were exercised in-session.
- **Not verifiable in this sandbox:** the `apps/kaizen` TypeScript build (`npm install` won't complete on the mounted FS — run `npm run build` on the deploy box/CI), and anything needing live rclone/restic/pg_dump/Redis/Socket.io (inherently server-side).
- **Realtime nuance:** in-dashboard socket push works from the API process; worker-emitted alerts (backup/drill failures) persist + email but don't socket-push (the worker has no `io`). The `/alerts` UI polls every 20s, so those still surface promptly.
- Commit the Kaizen work as a focused change; the working tree also carries unrelated CRLF churn.
