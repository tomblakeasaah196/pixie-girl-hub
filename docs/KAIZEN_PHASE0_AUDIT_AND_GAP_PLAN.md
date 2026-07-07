# Kaizen — Phase 0 Audit & Gap Plan

**Audited:** 2026-07-07 • **Auditor:** Claude (read-only pass, no code changed)
**Scope:** everything Kaizen-related currently in `tomblakeasaah196/pixie-girl-hub`
**Reference:** `docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md`, `ops/kaizen/RESTORE_RUNBOOK.md`

---

## 1. Headline

**Phase 0 (subdomain + auth + shell) is already built and wired.** A prior session scaffolded it to a genuinely deployable state. There is essentially nothing new to *write* for Phase 0 — the remaining work is human/infra: create the Cloudflare record, set env secrets, migrate, seed Tom, build the SPA, and point nginx at it. Two small polish items and one decision (Cloudflare Access) are outstanding.

Decisions locked in this pass: **backup retention = 7 daily / 4 weekly / 6 monthly**; **Cloudflare Access = yes** (add the JBS-emails-only outer gate).

---

## 2. What exists and was verified

### Backend — `src/modules/kaizen/` (complete for Phase 0)

| Area | Status | Notes |
| --- | --- | --- |
| `kaizen.routes.js` → `mountKaizen(app)` | ✅ | Wired into `src/routes/index.js` (line 312), mounted **outside** the brand-scoped router (no `X-Brand-Context`), exactly as the guide requires. |
| `auth/` (middleware, service, repo, controller, validator) | ✅ | Separate `KAIZEN_JWT_SECRET` + `aud:"kaizen"`; argon2; 30-min access token in body; rotating opaque refresh token stored **hashed**, delivered as httpOnly/Secure/SameSite=Strict cookie scoped to `/api/v1/kaizen/auth`. Login is constant-error (no user enumeration). Refresh rotates + revokes. Change-password keeps the caller's session, revokes the rest. |
| `operators/` (invite / list / disable) | ✅ | Invite emails the link **and** returns it as a copy-paste fallback if SMTP fails. Disable is guarded (`confirm:true`), blocks self-disable and last-active-operator, revokes sessions, audits. |
| Migration `000301_shared_kaizen_operators.sql` | ✅ | `kaizen_operators`, `kaizen_operator_invites`, `kaizen_operator_sessions`, `kaizen_audit_log`. Uses `CITEXT` email (extension enabled in `000001`) and `gen_random_uuid()` (pgcrypto enabled in `000001`). |
| `scripts/kaizen-create-operator.js` | ✅ | Seeds Tom as `active`, `must_change_password=true`. Password via env/flag/hidden-prompt — never committed. Validates email + password strength (≥8, upper, digit). |
| Env — `src/config/env.js` + `.env.example` | ✅ | `KAIZEN_JWT_SECRET`, `KAIZEN_ACCESS_TTL`, `KAIZEN_REFRESH_TTL_DAYS`, `KAIZEN_INVITE_TTL_HOURS`, `KAIZEN_BASE_URL`, `KAIZEN_COOKIE_DOMAIN`, plus the seed vars. All optional/defaulted so **the main API boots without them**; only the Kaizen auth path fails fast (503 `KAIZEN_NOT_CONFIGURED`) if the secret is missing. |

The controller→service→repo separation, `AppError` usage, parameterised SQL and Zod validation all match house style. Auth boundary is correct: a platform (`shared.users`) token cannot satisfy a Kaizen route (different secret + audience).

### Frontend — `apps/kaizen/` (complete for Phase 0)

Vite 5 + React 18 + TanStack Query v5 + Zustand 4 + React Router 6, cloned from `apps/admin` with a **distinct ops theme** (near-black `ink` palette, amber + signal-red accents, green/amber/red status semantics; Playfair/Montserrat/JetBrains Mono retained). Pages present: Login, Accept-Invite, Change-Password, Overview, Operators, and a Coming-Soon placeholder wired to the future nav (Errors=P1, Health/Perf=P2, Backups=P3, Alerts/Settings=P5). Access token held **in memory only**; silent refresh via the httpOnly cookie on boot; single transparent 401→refresh→retry in `api.ts`. Dev proxy `/api` + `/media` → `:7000`. A git build-fingerprint is injected as `<meta name="x-build">` for one-curl verification of the live build.

### Ops — `ops/kaizen/` (complete for Phase 0)

`nginx-kaizen.conf` (static SPA + `/api` + `/media` + `/socket.io` upgrade proxy, TLS via origin cert), a Phase-0 deploy `README.md`, and `RESTORE_RUNBOOK.md` (used from Phase 4).

---

## 3. Findings — issues & polish

Ordered by priority. None block a Phase 0 deploy except where noted.

1. **Migration number collisions (cosmetic now, must fix going forward).** `000301` is used by both `000301_shared_kaizen_operators.sql` and `000301_shared_messages_metadata.sql`; `000302`–`000304` are taken by splash/attendance/device-binding. This is **not fatal today** — the shared-migration runner keys `schema_migrations` by *full filename* and sorts by full filename, so both `000301_*` files apply independently. **But** the guide's plan to number the later Kaizen migrations `000302`–`000306` is now impossible. **Action:** number the Phase 1+ Kaizen migrations from the next free slot (**`000305` onward**), and treat "one number = one migration" as the rule from here.

2. **Cloudflare Access is only mentioned, not specified (decision: add it).** The ops README has a one-line "optional" note. Since we're committing to it, Phase 0 deploy should include a short, concrete CF Access runbook: create an Access application for `kaizen.pixiegirlglobal.com`, policy = *email ending in `@jbspraxis.com`* (plus any specific external addresses), session duration, and a bypass/service-token note for the `/api/v1/kaizen/ingest/*` endpoint that Phase 1 adds (so client apps can POST errors without a human login). Flagging now so the ingest path isn't accidentally locked out later.

3. **Access-token TTL is 30 min; guide says 15 min.** Minor, deliberate-looking deviation (`KAIZEN_ACCESS_TTL=30m`). Fine to keep, but note it against the guide. Tighten to `15m` if you want to match §7.2 exactly.

4. **Build not verified in this sandbox.** `apps/kaizen` has no committed `node_modules`; a clean `npm install` did not finish within the sandbox's time budget (slow mounted FS), so `npm run build` couldn't be exercised here. The code reads as type-clean and imports resolve, but **verify on the deploy box / CI** with `cd apps/kaizen && npm install && npm run build` before going live. Low risk, but it's the one acceptance box I couldn't tick myself.

5. **Working tree is entirely uncommitted.** `git status` shows the whole repo modified (incl. all the Kaizen files and a large amount of unrelated `apps/admin` churn). Before deploy, review and commit the Kaizen work as its own focused change so it's traceable and revertible.

6. **CI awareness.** `.github/workflows/ci.yml` is modified in the working tree — confirm the Kaizen app is included (or intentionally excluded) in lint/build CI so `apps/kaizen` doesn't silently rot.

---

## 4. Phase 0 deploy checklist (human/infra — Claude can't do these)

1. **Cloudflare DNS:** add `kaizen` A/CNAME → **the origin server IP/hostname the admin app uses** — *this is the one value still needed from Tom* — Proxied (orange), SSL/TLS Full (strict).
2. **Cloudflare Access:** add the JBS-emails-only policy (per finding #2).
3. **Backend `.env`:** set `KAIZEN_JWT_SECRET` (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), `KAIZEN_BASE_URL=https://kaizen.pixiegirlglobal.com`, optional `KAIZEN_COOKIE_DOMAIN`.
4. **Migrate + seed:** `npm run db:migrate:shared` then `node scripts/kaizen-create-operator.js` (password prompted, not committed); `pm2 restart pixie-girl-hub`.
5. **Build + nginx:** `cd apps/kaizen && npm install && npm run build`; copy `ops/kaizen/nginx-kaizen.conf` into `sites-available`, symlink, `nginx -t`, reload. Ensure the origin cert covers `kaizen.pixiegirlglobal.com`.
6. **Verify:** `curl -I https://kaizen.pixiegirlglobal.com/health` → 200; log in as Tom → forced password change → Overview shows API online; invite a teammate and accept.

**Acceptance criteria met (from guide §12, Auth & operators):** seed → forced change, login + refresh cookie, invite → accept, platform-JWT rejected on Kaizen routes, guarded+audited disable. All present in code; confirm live after deploy.

---

## 5. Decisions locked this pass

- **Backup retention: 7 daily / 4 weekly / 6 monthly** — for both logical (`rclone`) and full-volume (`restic --keep-daily 7 --keep-weekly 4 --keep-monthly 6`). Store in `kaizen_settings` (`backup.retention`) when Phase 3 lands so it's changeable without redeploy.
- **Cloudflare Access: yes** — JBS-emails-only outer gate in front of the app login (see finding #2 for the ingest caveat).

---

## 6. Still needed from Tom (does not block Phase 0 code, blocks go-live)

- **Origin server IP / hostname** for the Cloudflare `kaizen` record (§10.1). Copy from the existing `admin`/root record.
- Confirm the **origin TLS cert** already on nginx (Cloudflare Origin Cert or `*.pixiegirlglobal.com` wildcard) can be extended to `kaizen.pixiegirlglobal.com`.
- The **recovery-time SLA** number stays open until Phase 4 measures it — do not quote a figure before a real restore drill.

---

## 7. Gap plan — Phases 1–5

Each phase is an independently deployable vertical slice. Migration numbering below uses the next free slots (**`000305`+**), per finding #1.

### Phase 1 — Errors (the core Kaizen loop)
- **Migrations:** `000305_shared_kaizen_errors.sql` (`kaizen_error_groups`, `kaizen_error_occurrences`; unique index on `fingerprint`).
- **Backend:** `errors/` module — `errors.capture.js` (fire-and-forget, PII-redacted), `errors.fingerprint.js` (normalise → sha256 signature = message+code+route+top-frame), service upsert with `FOR UPDATE`/`ON CONFLICT` and **auto-reopen** on regression, `errors.export.js` (Markdown). Browse/resolve/ignore/reopen API, 30/page default.
- **Capture wiring (4 points):** `src/middleware/error-handler.js` (5xx + fall-through), `src/server.js` (`unhandledRejection`/`uncaughtException`), `src/jobs/worker.js` (BullMQ `failed` on every worker), and a public **ingest** endpoint `POST /api/v1/kaizen/ingest/client-error` (static `KAIZEN_INGEST_KEY` + origin allowlist + rate limit + payload cap).
- **Redaction:** reuse `src/config/logger.js` `redact.paths`; store only route/method/status/request_id/brand + opaque salted user ref; scrub email/phone/long-digit patterns from message+stack.
- **Frontend:** `/errors` table (filters, multi-select resolve/ignore, Export Markdown), `/errors/:id` detail; add `ErrorBoundary` + `window.onerror`/`onunhandledrejection` → ingest in **admin, storefront, stylist, landing, and kaizen** apps.
- **New env:** `KAIZEN_INGEST_KEY`, `KAIZEN_INGEST_ALLOWED_ORIGINS`, `KAIZEN_CAPTURE_4XX`.
- **CF Access caveat:** exempt `/api/v1/kaizen/ingest/*` from Access (service token or bypass) so client apps can report.

### Phase 2 — Health & performance
- **Migrations:** `000306_shared_kaizen_health_perf.sql` (`kaizen_health_snapshots`, `kaizen_perf_rollups`).
- **Backend:** `health/` probes (db/redis/queue/disk/mem/cpu + backup-freshness + restore-drill-freshness), `perf.middleware.js` (in-memory reservoir → 1-min rollups; never per-request rows). Schedulers: `kaizen-health-tick.js` (1 min) persists snapshots + flushes perf. Enhance existing `/health` with `?deep=1` (keep default `{ok:true}` public).
- **Frontend:** Overview tiles + `/health` and `/performance` charts (recharts).

### Phase 3 — Backups
- **Migrations:** `000307_shared_kaizen_backups.sql` (`kaizen_backup_destinations`, `kaizen_backup_runs`, `kaizen_restore_drills`) — **no secrets in these tables**.
- **Backend:** `backups/` — `logical-backup.js` (`pg_dump -Fc` + tar uploads/media + tar config → sha256 → `rclone copyto` to crypt remote → verify), `fullvolume-backup.js` (triggers the sudoers wrapper, reads status JSON + `restic snapshots --json`), `destinations/rclone.js` + `local.js`. `kaizen-backup` BullMQ queue for manual trigger/re-run; schedulers at 02:30 (logical) and 03:00 (full-volume). Retention pruning in the hourly maintenance tick — **prune artifacts, keep the run rows** (audit trail).
- **Ops (server, once, root):** install `rclone`+`restic`+`postgresql-client-16`; `rclone config` (`gdrive` + `gdrive-crypt`); `restic init`; add `ops/kaizen/kaizen-fullbackup.sh` (→ `/usr/local/bin`, chmod 750), `ops/kaizen/sudoers-kaizen` (NOPASSWD, that one command), optional `ops/kaizen/kaizen-restic-cron` (documented fallback, disabled); `scripts/kaizen-setup-check.js` green.
- **Env:** the full `KAIZEN_RCLONE_*`, `KAIZEN_RESTIC_*`, `KAIZEN_BACKUP_STAGING_DIR`, `KAIZEN_FULLBACKUP_CMD`, `KAIZEN_SCRATCH_DB` block.
- **Retention:** wire the locked **7/4/6** into `restic forget` and the logical pruner; expose in `kaizen_settings`.

### Phase 4 — Restore drills + runbook
- **Backend:** `restore-drill.js` (weekly Sun 04:00): download latest logical dump → scratch DB → `pg_restore` → canary row-count assertions → time it → pass/fail → drop scratch; critical alert on fail. Surface the "✅ last verified restore — took N min" badge.
- **Deliverable:** run a **real Path-C rehearsal on a throwaway box** (RESTORE_RUNBOOK already written) to measure true RTO and set the honest client SLA.

### Phase 5 — Alerts & polish
- **Migrations:** `000308_shared_kaizen_alerts.sql` (`kaizen_alert_rules`, `kaizen_alerts`, `kaizen_settings`) + seed default rules.
- **Backend:** `alerts/` rule evaluation (event-driven + hourly tick), dedupe within a window, email + in-dash channels (reuse `email.service`), Socket.io `kaizen:ops` room. `kaizen-maintenance-tick.js` (hourly): alert eval + retention/occurrence pruning.
- **Frontend:** `/alerts` (acknowledge, rule management), `/settings` (retention, alert recipients, default destination, ingest key), Socket.io live toasts on `error:new`/`backup:*`/`alert:new`.

*Deferred post-v1: AI health summaries; multi-client central console; one-click restore-to-prod.*

---

## 8. Recommended next step

Because Phase 0 is code-complete, the highest-value move is not more code — it's **getting Phase 0 live** (needs the origin IP from Tom) so we can start capturing real errors, then building **Phase 1 (Errors)** which is where the promised "detect → fix → verify" value actually lands. Say the word and I'll start Phase 1: migrations `000305`, the capture pipeline + fingerprinting, and the ingest endpoint.
