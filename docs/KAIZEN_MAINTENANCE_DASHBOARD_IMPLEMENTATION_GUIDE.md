# Kaizen — Maintenance & Continuous-Improvement Dashboard

**Implementation Guide (build-ready)**
**Product owner:** Tom Asaah — JBS Praxis
**Target repo:** `tomblakeasaah196/pixie-girl-hub`
**Target subdomain:** `kaizen.pixiegirlglobal.com`
**Status:** Approved for build. This document is the single source of truth. Read it fully before writing code.

---

> **What this is, in one sentence.** Kaizen is a private, agency-only operations cockpit for JBS Praxis that lets us watch the live Pixie Girl Hub deployment — see errors as they happen, track system health and performance, run and verify daily off-site backups, and restore the whole server after a disaster — so "maintenance & continuous improvement" is a thing we can *prove*, not a promise we hope holds.

> **Kaizen (改善)** = *continuous improvement*. The whole product is built around one loop: **detect → fix → verify it stays fixed → know instantly if it regresses.**

---

## Table of contents

1. [Vision & goals](#1-vision--goals)
2. [Scope for v1 (in / out)](#2-scope-for-v1-in--out)
3. [Decisions ledger (why things are the way they are)](#3-decisions-ledger)
4. [Architecture overview](#4-architecture-overview)
5. [Repository layout — what you will add](#5-repository-layout)
6. [Data model (all tables + DDL)](#6-data-model)
7. [Backend implementation](#7-backend-implementation)
   - 7.1 [Module skeleton & routing](#71-module-skeleton--routing)
   - 7.2 [Kaizen auth — separate operator identity](#72-kaizen-auth)
   - 7.3 [Error capture pipeline (fingerprinting, resolve, auto-reopen)](#73-error-capture-pipeline)
   - 7.4 [Health checks](#74-health-checks)
   - 7.5 [Performance metrics](#75-performance-metrics)
   - 7.6 [Backup subsystem](#76-backup-subsystem)
   - 7.7 [Restore drills & restore runbook](#77-restore-drills--restore-runbook)
   - 7.8 [Notifications & alert rules](#78-notifications--alert-rules)
   - 7.9 [Realtime (Socket.io)](#79-realtime)
   - 7.10 [Scheduler & worker wiring](#710-scheduler--worker-wiring)
8. [Frontend — `apps/kaizen`](#8-frontend-appskaizen)
9. [Environment variables](#9-environment-variables)
10. [Infrastructure & deployment](#10-infrastructure--deployment)
    - 10.1 [Cloudflare — create the subdomain](#101-cloudflare--create-the-subdomain)
    - 10.2 [nginx server block](#102-nginx-server-block)
    - 10.3 [Build & PM2](#103-build--pm2)
    - 10.4 [System-level: rclone + restic + cron + sudoers](#104-system-level-rclone--restic--cron--sudoers)
11. [Security considerations](#11-security-considerations)
12. [Testing & acceptance criteria](#12-testing--acceptance-criteria)
13. [Phased rollout plan](#13-phased-rollout-plan)
14. [Operational runbooks](#14-operational-runbooks)
15. [Assumptions & open items](#15-assumptions--open-items)
16. [Appendix A — file-by-file build checklist](#appendix-a--file-by-file-build-checklist)

---

## 1. Vision & goals

We build ERP/CRM systems for clients and then lose sight of them. We only find out about problems when the client complains; we discover errors by SSH-ing in and reading log files; we have no live view of health or performance; and — most dangerously — **we have no automated, verified backups.** If Pixie Girl's server died today, we could not confidently say how much we'd lose or how fast we could bring them back.

Kaizen fixes that. It is a maintenance console living at `kaizen.pixiegirlglobal.com` that JBS Praxis engineers log into. From it we can:

- **See every error the app throws, live**, grouped so one bug is one row (not 500), with count, first/last seen, and full (PII-redacted) context. Triage in bulk, mark resolved, export to Markdown, and get auto-alerted when a "fixed" bug comes back.
- **Watch system health**: database, Redis, background queues, disk, memory, CPU — green/degraded/down at a glance.
- **Watch performance**: request latency (p50/p95/p99), error rate, throughput, slow endpoints, queue depth and failed jobs.
- **Run daily off-site backups automatically** — database, uploads/media, config, and a full-volume image — to storage we control, with a status ledger showing every run, success or failure, with one-click re-run of failures.
- **Prove backups actually restore** via weekly automated restore drills that time themselves, so our recovery SLA is measured, not guessed.
- **Restore after a disaster** using off-site artifacts and a scripted runbook.

### Non-negotiable principles

1. **Agency-only.** Kaizen is JBS Praxis's cockpit. The client's platform users (even the client CEO) must never be able to reach it. It has its **own** identity store, separate from the client's `shared.users`.
2. **Prove, don't promise.** Anything we tell the client (e.g. "we back you up daily and can restore you") must be backed by evidence Kaizen surfaces (last successful backup, last verified restore + how long it took).
3. **Least data at rest.** Error payloads and logs may contain customer data. Capture is **PII-redacted**. Backups containing real data are **encrypted at rest** off-site.
4. **Reuse, don't reinvent.** The Pixie Girl Hub backend already has almost every primitive we need (Pino logging, central error-handler, cron-lock, BullMQ workers, Socket.io, email service, encryption service, an established module + migration pattern, and an admin frontend to clone). Build *on* them.

---

## 2. Scope for v1 (in / out)

### In scope (build now)

| Area | Deliverable |
| --- | --- |
| Subdomain | `kaizen.pixiegirlglobal.com` on Cloudflare → nginx → static Kaizen SPA + `/api` proxy to the existing backend |
| Auth | Separate `kaizen_operators` identity store; seed first operator; invite-by-email; everyone is an admin (no internal RBAC); audit log; guards on destructive actions |
| Errors | Server + frontend capture, fingerprint/group, 30-per-page browse, filters, detail view, multi-select resolve, Markdown export, auto-reopen on regression |
| Health | DB / Redis / queue / disk / memory / CPU / backup-freshness / restore-drill-freshness probes |
| Performance | Per-route latency percentiles, error rate, throughput, slow endpoints, queue depth & failed jobs |
| Backups | Daily logical backup (DB + uploads + config) **and** full-volume (restic) to off-site storage via rclone; status ledger; manual trigger & re-run of failures; retention policy |
| Restore | Weekly automated restore drill (timed, pass/fail); documented + scripted restore runbook |
| Alerts | Email + in-dashboard notifications with configurable rules (no WhatsApp/SMS in v1) |

### Out of scope (explicitly deferred)

- **Multi-client** central console (Kaizen watching many client servers). v1 is Pixie-only. *But* the backup design already stores artifacts off-site, which is the hard prerequisite — so this is a later product, not a rewrite.
- **AI health summaries / anomaly detection** (Praxis integration). Phase 2.
- **One-click restore-to-production.** Too dangerous for v1; restore is a guarded, scripted, restore-to-a-fresh-target procedure.
- **RBAC inside Kaizen.** All operators are full admins.
- **WhatsApp / SMS alerting.**

---

## 3. Decisions ledger

These are settled. Do not re-litigate; if reality forces a change, raise it with Tom before deviating.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Single-tenant (Pixie only).** Handover-for-a-fee if they leave JBS. | Fast to value; multi-client is a future product. |
| D2 | **Kaizen backend = a new module in the existing Node backend** (`src/modules/kaizen/`) + new `shared.kaizen_*` tables. | Maximum reuse of auth infra, DB pool, logger, schedulers, Socket.io. |
| D2a | The **backup/heartbeat pieces run in the worker process** (`npm run workers:start`), which is already separate from the API — so a crashed API doesn't kill the thing that backs it up. | Blast-radius isolation without a whole new service. |
| D3 | **Separate `kaizen_operators` identity store**, distinct JWT, invisible to client platform users. **No internal RBAC** (everyone's an admin) but **audit log + destructive-action guards**. | Hard security boundary; discipline without bureaucracy. |
| D4 | **Own error store with fingerprint/grouping**, resolve-not-delete, **auto-reopen on recurrence**, Markdown export, 30/page. | Triage stays sane; the Kaizen loop made literal. |
| D5 | **Hybrid live**: Socket.io push for critical alarms + new criticals; polled pagination for the archive tables. | Reuses existing realtime; best signal-to-noise. |
| D6 | **rclone is the universal backup transport** (Drive first, swap to S3/OneDrive/etc. by config). **restic** for full-volume. **`rclone crypt`** for encryption-at-rest of logical artifacts. | One tool, 70+ providers, native restic integration, free encryption. Swapping providers = config, not code. |
| D7 | **Weekly automated restore drills**, timed, pass/fail badge. Quote the recovery SLA from measured drill results, never a guess. | So we never sell the client a lie. |
| D8 | v1 telemetry = **errors + backups + health + performance.** AI later. | Sweet spot of value vs. effort. |
| D9 | **Email + in-dashboard notifications only.** | Per owner decision. |
| D10 | **Frontend clones `apps/admin`** (React 18 + Vite 5 + TanStack Query v5 + Zustand + React Router 6 + Socket.io-client), with a **distinct "ops" theme** so it's unmistakable you're in the maintenance console. | Reuse the design system + components; avoid "which app am I in?" |

---

## 4. Architecture overview

```
                          Cloudflare DNS (proxied)
   kaizen.pixiegirlglobal.com ─┐   admin/storefront/… .pixiegirlglobal.com
                               │
                          ┌────▼─────────────────────────────────────────┐
                          │                  nginx                        │
                          │  server_name kaizen.pixiegirlglobal.com       │
                          │   / …  → static  apps/kaizen/dist (SPA)        │
                          │   /api → proxy   127.0.0.1:7000 (Node backend) │
                          │   /media → proxy 127.0.0.1:7000                │
                          └───────────────────────────┬───────────────────┘
                                                       │
   ┌───────────────────────────────────────────────────▼───────────────────────────┐
   │                       Existing Node backend (Express, :7000)                    │
   │                                                                                 │
   │  Every request → error-handler (already central) ── captureError() ──┐          │
   │  perfTimer middleware ── rollups ────────────────────────────────────┤          │
   │                                                                       ▼          │
   │  src/modules/kaizen/                              shared.kaizen_* tables         │
   │    kaizen.routes/controller/service/repo/validator/events                       │
   │    auth (separate operators)  errors  health  perf  backups  alerts             │
   │                                                                                 │
   │  process handlers (uncaughtException/unhandledRejection) → captureError()       │
   └───────────────────────────────────────────────┬─────────────────────────────────┘
                                                    │ (shared Postgres + Redis)
   ┌────────────────────────────────────────────────▼───────────────────────────────┐
   │                Worker process (npm run workers:start)                            │
   │   cron (withCronLock):                                                           │
   │     02:30  logical backup (pg_dump + uploads + config) → rclone crypt → Drive    │
   │     03:00  full-volume backup trigger (sudo restic via rclone) → Drive           │
   │     Sun 04:00  restore drill (download latest dump → scratch DB → assert → time) │
   │     */1 min  health snapshot + perf rollup flush                                 │
   │     hourly  alert-rule evaluation, retention pruning                             │
   │   BullMQ 'failed' listeners on all queues → captureError()                       │
   └─────────────────────────────────────────────────────────────────────────────────┘

   System level (root cron + sudoers wrapper), OUTSIDE Node:
     restic + rclone perform the actual full-volume imaging; Kaizen is the cockpit
     (triggers, reads status JSON, displays, re-runs, alerts).
```

Key idea: **Node owns the logical backup, the ledger, the UI, health, perf, errors and alerts. `restic`+`rclone` own the heavy full-volume imaging. Kaizen orchestrates and displays both.**

---

## 5. Repository layout

Everything you add. Follow existing conventions exactly (CommonJS `require`, `"use strict"`, parameterised SQL, Pino logger, `AppError`).

```
migrations/
  000301_shared_kaizen_operators.sql
  000302_shared_kaizen_errors.sql
  000303_shared_kaizen_health_perf.sql
  000304_shared_kaizen_backups.sql
  000305_shared_kaizen_alerts.sql
  000306_shared_kaizen_indexes.sql

src/modules/kaizen/
  README.md
  kaizen.routes.js                 # mounts all sub-routers under /api/v1/kaizen
  kaizen.events.js                 # domain events (socket/alert subscribers)
  auth/
    kaizen-auth.controller.js
    kaizen-auth.service.js
    kaizen-auth.repo.js
    kaizen-auth.validator.js
    kaizen-auth.middleware.js      # verifies KAIZEN JWT → req.operator
  errors/
    errors.controller.js
    errors.service.js
    errors.repo.js
    errors.validator.js
    errors.capture.js              # captureError() — fire-and-forget, fingerprints
    errors.fingerprint.js          # normalisation + hashing
    errors.export.js               # Markdown export
  health/
    health.controller.js
    health.service.js              # probes DB/Redis/queue/disk/mem/cpu/backup/drill
    health.repo.js
  perf/
    perf.middleware.js             # per-request timing → in-memory ring → flush
    perf.controller.js
    perf.service.js
    perf.repo.js
  backups/
    backups.controller.js
    backups.service.js             # orchestration, ledger, trigger, rerun
    backups.repo.js
    backups.validator.js
    logical-backup.js              # pg_dump + uploads + config bundle
    fullvolume-backup.js           # shells sudo wrapper for restic, reads status
    restore-drill.js               # weekly verified restore
    destinations/
      rclone.js                    # thin wrapper over rclone (copy/ls/delete/about)
      local.js                     # local-disk fallback (no rclone needed)
  alerts/
    alerts.controller.js
    alerts.service.js              # rule evaluation, dedupe, email + in-dash
    alerts.repo.js
    alerts.validator.js
  operators/
    operators.controller.js        # invite / list / disable
    operators.service.js
    operators.repo.js
    operators.validator.js

src/jobs/schedulers/
  kaizen-logical-backup.js
  kaizen-fullvolume-backup.js
  kaizen-restore-drill.js
  kaizen-health-tick.js            # health snapshot + perf flush (1 min)
  kaizen-maintenance-tick.js       # alert eval + retention pruning (hourly)

scripts/
  kaizen-create-operator.js        # seed first operator (password from env/prompt)
  kaizen-setup-check.js            # verifies rclone/restic/pg_dump present + reachable

apps/kaizen/                       # cloned & simplified from apps/admin (see §8)

docs/
  KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md   # (this file)

ops/kaizen/                        # deploy artifacts (committed, used at deploy time)
  nginx-kaizen.conf                # nginx server block
  kaizen-fullbackup.sh             # sudoers-whitelisted restic wrapper (runs as root)
  kaizen-restic-cron               # /etc/cron.d entry for full-volume
  sudoers-kaizen                   # /etc/sudoers.d entry (app user → wrapper, NOPASSWD)
  README.md                        # deploy steps (mirror of §10)
```

Wiring into existing files (exact insertion points in §7):
- `src/routes/index.js` — mount the Kaizen router; enhance `/health`.
- `src/middleware/error-handler.js` — call `captureError()` (fire-and-forget).
- `src/server.js` — install `perf.middleware`, add process-level error handlers, register Kaizen socket namespace.
- `src/jobs/worker.js` — register the five Kaizen schedulers + BullMQ `failed` capture listeners.
- `src/config/env.js` — add the Kaizen env vars to the Zod schema.
- `.env.example` — document the new vars.
- `ecosystem.config.js` — no change needed (Kaizen SPA is static, served by nginx like admin; the worker already runs).

---

## 6. Data model

All Kaizen tables live in the **`shared`** schema (they are cross-cutting, not per-brand). Follow the existing migration style. Latest shared migration today is `000300`; **start at `000301`.** Use `uuid` PKs (`gen_random_uuid()` — `pgcrypto` is already enabled in this DB), `timestamptz`, and `snake_case`.

> **Forward-compat note (cheap insurance for the future multi-client product):** none required for v1, but if trivial, you may add a nullable `deployment_key text` defaulting to `'pixiegirl'` on the operational tables. Not mandatory.

### 6.1 `000301_shared_kaizen_operators.sql`

```sql
-- Kaizen operators: JBS Praxis staff. SEPARATE from shared.users on purpose —
-- a client platform user must never be able to authenticate into Kaizen.

CREATE TABLE shared.kaizen_operators (
  operator_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  display_name       text NOT NULL,
  phone              text,
  password_hash      text,                         -- argon2; NULL until invite accepted
  status             text NOT NULL DEFAULT 'invited'
                       CHECK (status IN ('invited','active','disabled')),
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at      timestamptz,
  created_by         uuid REFERENCES shared.kaizen_operators(operator_id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_kaizen_operators_email
  ON shared.kaizen_operators (lower(email));

-- Pending invites (email + one-time token). Token is stored HASHED.
CREATE TABLE shared.kaizen_operator_invites (
  invite_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  token_hash    text NOT NULL,                     -- sha256 of the raw token
  invited_by    uuid NOT NULL REFERENCES shared.kaizen_operators(operator_id),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_invites_email ON shared.kaizen_operator_invites (lower(email));

-- Refresh-token sessions (so we can revoke). Access token is short-lived JWT.
CREATE TABLE shared.kaizen_operator_sessions (
  session_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id        uuid NOT NULL REFERENCES shared.kaizen_operators(operator_id) ON DELETE CASCADE,
  jti                uuid NOT NULL,
  refresh_token_hash text NOT NULL,
  user_agent         text,
  ip                 inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);
CREATE INDEX ix_kaizen_sessions_operator ON shared.kaizen_operator_sessions (operator_id);

-- Audit: who did what in Kaizen (no RBAC, but full accountability).
CREATE TABLE shared.kaizen_audit_log (
  audit_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid REFERENCES shared.kaizen_operators(operator_id),
  action       text NOT NULL,                      -- e.g. 'backup.trigger','error.resolve','operator.invite','restore.run'
  target_type  text,
  target_id    text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_audit_created ON shared.kaizen_audit_log (created_at DESC);
```

### 6.2 `000302_shared_kaizen_errors.sql`

```sql
-- One row per unique bug (grouped by fingerprint).
CREATE TABLE shared.kaizen_error_groups (
  group_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint       text NOT NULL,                 -- sha256 of normalised signature
  title             text NOT NULL,                 -- human summary (normalised message)
  error_code        text,                          -- AppError code / PG code / 'UNCAUGHT'
  source            text NOT NULL DEFAULT 'backend'
                      CHECK (source IN ('backend','worker','admin','storefront','stylist','landing','unknown')),
  route_pattern     text,                          -- e.g. 'POST /api/v1/sales/:id/pay'
  http_status       integer,
  severity          text NOT NULL DEFAULT 'error'
                      CHECK (severity IN ('info','warning','error','critical')),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','resolved','ignored')),
  occurrence_count  bigint NOT NULL DEFAULT 0,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES shared.kaizen_operators(operator_id),
  resolution_note   text,
  reopened_at       timestamptz,                   -- set when a resolved group recurs
  reopen_count      integer NOT NULL DEFAULT 0,
  sample            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- latest redacted context snapshot
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_kaizen_error_fingerprint ON shared.kaizen_error_groups (fingerprint);
CREATE INDEX ix_kaizen_error_status_last ON shared.kaizen_error_groups (status, last_seen_at DESC);
CREATE INDEX ix_kaizen_error_severity ON shared.kaizen_error_groups (severity, last_seen_at DESC);

-- Individual occurrences (retained bounded — see retention in §7.10).
CREATE TABLE shared.kaizen_error_occurrences (
  occurrence_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES shared.kaizen_error_groups(group_id) ON DELETE CASCADE,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  request_id     text,
  route          text,
  method         text,
  http_status    integer,
  brand          text,                             -- pixiegirl/faitlynhair/null
  user_ref       text,                             -- hashed/opaque user id, NOT PII
  message        text,
  stack          text,
  context        jsonb NOT NULL DEFAULT '{}'::jsonb -- redacted (see redaction rules §7.3)
);
CREATE INDEX ix_kaizen_occ_group_time ON shared.kaizen_error_occurrences (group_id, occurred_at DESC);
```

### 6.3 `000303_shared_kaizen_health_perf.sql`

```sql
CREATE TABLE shared.kaizen_health_snapshots (
  snapshot_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at  timestamptz NOT NULL DEFAULT now(),
  component    text NOT NULL,     -- 'db','redis','queue','disk','memory','cpu','backup','restore_drill'
  status       text NOT NULL CHECK (status IN ('ok','degraded','down')),
  latency_ms   integer,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_kaizen_health_comp_time ON shared.kaizen_health_snapshots (component, captured_at DESC);

CREATE TABLE shared.kaizen_perf_rollups (
  rollup_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  route_pattern text NOT NULL,
  method        text NOT NULL,
  req_count     integer NOT NULL DEFAULT 0,
  err_count     integer NOT NULL DEFAULT 0,
  p50_ms        integer,
  p95_ms        integer,
  p99_ms        integer,
  max_ms        integer
);
CREATE INDEX ix_kaizen_perf_window ON shared.kaizen_perf_rollups (window_start DESC);
CREATE INDEX ix_kaizen_perf_route ON shared.kaizen_perf_rollups (route_pattern, window_start DESC);
```

### 6.4 `000304_shared_kaizen_backups.sql`

```sql
CREATE TABLE shared.kaizen_backup_destinations (
  destination_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,               -- 'Google Drive (Tom)'
  kind           text NOT NULL CHECK (kind IN ('rclone','local')),
  rclone_remote  text,                        -- e.g. 'gdrive-crypt:' (name configured via `rclone config`)
  path_prefix    text NOT NULL DEFAULT 'pixiegirl-hub/backups',
  is_default     boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- NON-secret metadata only
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- NOTE: NO secrets in this table. rclone credentials live in the rclone config
-- file on the server (encrypted). This table only names which remote to use.

CREATE TABLE shared.kaizen_backup_runs (
  run_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('logical_db','logical_bundle','full_volume')),
  destination_id  uuid REFERENCES shared.kaizen_backup_destinations(destination_id),
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','success','failed','canceled')),
  trigger         text NOT NULL DEFAULT 'scheduled'
                    CHECK (trigger IN ('scheduled','manual','rerun')),
  retention_class text NOT NULL DEFAULT 'daily'
                    CHECK (retention_class IN ('daily','weekly','monthly')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     integer,
  size_bytes      bigint,
  artifact_key    text,                        -- rclone path OR restic snapshot id
  checksum        text,                        -- sha256 for logical artifacts
  log             text,                        -- tail of stdout/stderr
  error           text,
  created_by      uuid REFERENCES shared.kaizen_operators(operator_id),  -- null when scheduled
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_backup_kind_time ON shared.kaizen_backup_runs (kind, started_at DESC);
CREATE INDEX ix_kaizen_backup_status ON shared.kaizen_backup_runs (status, started_at DESC);

CREATE TABLE shared.kaizen_restore_drills (
  drill_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_run_id      uuid REFERENCES shared.kaizen_backup_runs(run_id),
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  duration_ms        integer,
  status             text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running','pass','fail')),
  assertions         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {expected, got, ok} per check
  restored_row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_drill_time ON shared.kaizen_restore_drills (started_at DESC);
```

### 6.5 `000305_shared_kaizen_alerts.sql`

```sql
CREATE TABLE shared.kaizen_alert_rules (
  rule_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  condition_type text NOT NULL
                   CHECK (condition_type IN
                     ('error_new_critical','error_spike','backup_failed',
                      'health_degraded','restore_drill_failed','perf_p95_breach','disk_low')),
  threshold      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"count":20,"window_min":5} or {"p95_ms":2000}
  channels       text[] NOT NULL DEFAULT ARRAY['email','in_dash'],
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shared.kaizen_alerts (
  alert_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         uuid REFERENCES shared.kaizen_alert_rules(rule_id),
  kind            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  title           text NOT NULL,
  body            text,
  source_ref      text,                              -- e.g. error group_id, backup run_id
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','acknowledged','resolved')),
  dedupe_key      text,                              -- suppress duplicate alerts within a window
  channels_sent   jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid REFERENCES shared.kaizen_operators(operator_id),
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_alerts_status_time ON shared.kaizen_alerts (status, created_at DESC);
CREATE INDEX ix_kaizen_alerts_dedupe ON shared.kaizen_alerts (dedupe_key, created_at DESC);

-- Simple settings singleton (retention, alert recipient emails, drive folder, etc.)
CREATE TABLE shared.kaizen_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 6.6 `000306_shared_kaizen_indexes.sql`

Any additional composite indexes discovered during build (e.g. partial index `WHERE status='open'` on error groups). Keep migrations additive; never edit a shipped migration.

---

## 7. Backend implementation

### 7.1 Module skeleton & routing

Follow the established module shape: **controller** (HTTP only) → **service** (logic/transactions/events/audit) → **repo** (parameterised SQL only). Controllers never touch repos; services never touch `req`/`res`; repos never emit events.

**`src/modules/kaizen/kaizen.routes.js`** mounts sub-routers. All routes are under `/api/v1/kaizen`. **Auth boundary:** every route except the auth/login and invite-accept endpoints is behind `kaizenAuthMiddleware` (NOT the platform `authMiddleware`).

```js
"use strict";
const express = require("express");
const { kaizenAuthMiddleware } = require("./auth/kaizen-auth.middleware");

const authRouter       = require("./auth/kaizen-auth.controller").router;
const errorsRouter     = require("./errors/errors.controller").router;
const healthRouter     = require("./health/health.controller").router;
const perfRouter       = require("./perf/perf.controller").router;
const backupsRouter    = require("./backups/backups.controller").router;
const alertsRouter     = require("./alerts/alerts.controller").router;
const operatorsRouter  = require("./operators/operators.controller").router;
const ingestRouter     = require("./errors/errors.controller").ingestRouter; // frontend error ingest

function mountKaizen(app) {
  const r = express.Router();

  // Public (no operator auth): login, refresh, invite-accept, frontend error ingest
  r.use("/auth", authRouter);
  r.use("/ingest", ingestRouter);          // guarded by an ingest key + rate limit, not JWT

  // Everything else requires a valid Kaizen operator
  r.use(kaizenAuthMiddleware);
  r.use("/errors", errorsRouter);
  r.use("/health", healthRouter);
  r.use("/perf", perfRouter);
  r.use("/backups", backupsRouter);
  r.use("/alerts", alertsRouter);
  r.use("/operators", operatorsRouter);

  app.use("/api/v1/kaizen", r);
}
module.exports = { mountKaizen };
```

**Wire into `src/routes/index.js`** (inside `mountRoutes`, after the other module mounts):

```js
const { mountKaizen } = require("../modules/kaizen/kaizen.routes");
mountKaizen(app);
```

API response shape must match the app convention (see `docs/API_CONVENTIONS.md`): success returns the resource/list; errors flow through the central error-handler (`{ error: { code, message, fields? }, request_id }`). Pagination: `?page=1&page_size=30` returning `{ data, pagination: { page, page_size, total, total_pages } }`. **Error list defaults to `page_size=30`.**

### 7.2 Kaizen auth

**Separate identity.** Operators authenticate against `shared.kaizen_operators`, not `shared.users`. Use a **distinct JWT secret** (`KAIZEN_JWT_SECRET`) and an `aud: "kaizen"` claim so a platform token can never be replayed against Kaizen routes and vice-versa.

Reuse the app's crypto choices:
- **Password hashing: `argon2`** (already a dependency — the platform `create-admin.js` and `auth.service` use argon2, *not* bcrypt).
- Access token: short-lived JWT (15 min). Refresh token: opaque random, stored **hashed** in `kaizen_operator_sessions`, delivered as an **httpOnly, Secure, SameSite=Strict cookie** scoped to the kaizen host. Never localStorage. (Mirror the platform's token model.)

**`kaizen-auth.middleware.js`:**

```js
"use strict";
const jwt = require("jsonwebtoken");
const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const { getOperatorById } = require("./kaizen-auth.repo");

async function kaizenAuthMiddleware(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError("KAIZEN_AUTH_REQUIRED", "Authorization required", 401);
  }
  let payload;
  try {
    payload = jwt.verify(header.slice(7).trim(), config.KAIZEN_JWT_SECRET, {
      audience: "kaizen",
    });
  } catch {
    throw new AppError("KAIZEN_INVALID_TOKEN", "Invalid or expired token", 401);
  }
  const op = await getOperatorById(payload.sub);
  if (!op || op.status !== "active") {
    throw new AppError("KAIZEN_OPERATOR_INACTIVE", "Operator not active", 401);
  }
  req.operator = { operator_id: op.operator_id, email: op.email, display_name: op.display_name };
  return next();
}
module.exports = { kaizenAuthMiddleware };
```

**Endpoints:**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/kaizen/auth/login` | none | email + password → access token (+ refresh cookie). Blocks if `status!='active'`. |
| POST | `/api/v1/kaizen/auth/refresh` | refresh cookie | rotate access token |
| POST | `/api/v1/kaizen/auth/logout` | operator | revoke session |
| POST | `/api/v1/kaizen/auth/change-password` | operator | required when `must_change_password=true` |
| GET | `/api/v1/kaizen/operators` | operator | list operators |
| POST | `/api/v1/kaizen/operators/invite` | operator | body `{ email, display_name }` → creates invite + emails link |
| POST | `/api/v1/kaizen/auth/accept-invite` | none | body `{ token, password }` → activates operator |
| POST | `/api/v1/kaizen/operators/:id/disable` | operator | **guarded** (confirmation) — sets `status='disabled'`, revokes sessions |

**Invite flow:** `invite` → insert `kaizen_operator_invites` with `token_hash = sha256(rawToken)`, `expires_at = now()+72h`; email a link `https://kaizen.pixiegirlglobal.com/accept-invite?token=<rawToken>` via `src/services/email.service.js`. `accept-invite` verifies the (unexpired, unaccepted) token, creates/updates the operator with an argon2 hash, marks invite accepted.

**Seed script — `scripts/kaizen-create-operator.js`** (mirror `scripts/create-admin.js`; **never commit a password**):

```
Usage:
  KAIZEN_ADMIN_EMAIL=tom.asaah@jbspraxis.com \
  KAIZEN_ADMIN_NAME="Tom Asaah" \
  KAIZEN_ADMIN_PHONE=09020868023 \
  KAIZEN_ADMIN_PASSWORD='<set-at-deploy>' \
  node scripts/kaizen-create-operator.js
  # If KAIZEN_ADMIN_PASSWORD is omitted, the script PROMPTS for it (hidden input).
  # It sets must_change_password=true so Tom rotates it on first login.
```

The script: validate email + password strength (min 8, an uppercase, a number — same regex as `create-admin.js`), argon2-hash, insert `kaizen_operators` with `status='active'`, `must_change_password=true`. **Seed values for Tom:** `Tom Asaah`, `tom.asaah@jbspraxis.com`, `09020868023` (phone is record-only; no SMS/WhatsApp in v1). **Do not put the password in any committed file** — it is supplied via env/prompt at deploy time, or, alternatively, seed only the email and send Tom an invite email so he sets his own password.

**Destructive-action guards:** operations that can lose data or access — `operators/:id/disable`, `backups` delete, and any restore action — require an explicit `confirm: true` (or a typed confirmation string echoed back) in the request body, and **must** write a `kaizen_audit_log` row via the service layer.

### 7.3 Error capture pipeline

**Goal:** every meaningful error — from the API, the workers, and the frontends — lands as an occurrence, grouped by fingerprint, PII-redacted, with `open`/`resolved`/`ignored` lifecycle and **auto-reopen** on regression.

#### Capture points (instrument all four)

1. **API errors — `src/middleware/error-handler.js`.** In `errorHandler(...)`, after the response is decided, fire-and-forget a capture. Do **not** await (never block the response, never throw from capture). Capture 5xx and uncaught fall-through always; capture 4xx only for `severity>=warning` you care about (skip routine validation 400s to avoid noise — make this configurable). Insert one line near the top of the function and at the fall-through:

   ```js
   const { captureError } = require("../modules/kaizen/errors/errors.capture");
   // ... inside errorHandler, in the unhandled fall-through branch:
   captureError(err, req, { source: "backend", httpStatus: 500 }); // fire-and-forget
   ```

   `captureError` must wrap its own body in try/catch and log-and-swallow on failure — **capture must never break request handling.**

2. **Process-level — `src/server.js`.** Add:

   ```js
   process.on("unhandledRejection", (reason) =>
     captureError(reason, null, { source: "backend", code: "UNHANDLED_REJECTION", severity: "critical" }));
   process.on("uncaughtException", (err) => {
     captureError(err, null, { source: "backend", code: "UNCAUGHT_EXCEPTION", severity: "critical" });
     // keep existing shutdown behaviour, if any
   });
   ```

3. **Worker/job failures — `src/jobs/worker.js`.** On each BullMQ `Worker`, add a `failed` listener; and wrap cron ticks:

   ```js
   worker.on("failed", (job, err) =>
     captureError(err, null, { source: "worker", code: `JOB_${job?.name}`, severity: "error",
       context: { queue: worker.name, jobId: job?.id } }));
   ```

4. **Frontend errors — ingest endpoint.** `POST /api/v1/kaizen/ingest/client-error` (no operator JWT; protected by a static ingest key + strict rate limit + payload size cap + origin allowlist). The admin/storefront/stylist/landing apps install a global `window.onerror` + `ErrorBoundary` + a fetch/axios error hook that POSTs `{ source, message, stack, route, appVersion }` with header `X-Kaizen-Ingest-Key`. Reuse the existing `publicWriteLimiter` pattern from `src/middleware`. **Redact on the client too** (never send form values).

#### Redaction (mandatory)

`captureError` builds `context` from the request but **strips PII** before storing. Reuse the philosophy already in `src/config/logger.js` `redact.paths`. Concretely:
- **Never store**: request body values, `authorization`/`cookie` headers, tokens, passwords, PINs, bank/account numbers, emails, phone numbers, full names, addresses.
- **Do store**: route pattern, method, http status, `request_id`, brand, an **opaque user reference** (`sha256(user_id + salt)` — not the raw id), error code, normalised message, stack, and a whitelist of safe context keys (e.g. `resource_type`, numeric ids that are not PII).
- Run the message and stack through a scrubber that replaces email/phone/long-digit patterns with `[redacted]` as a belt-and-braces second layer.

#### Fingerprinting — `errors.fingerprint.js`

```
normalise(message):
  lowercase; strip UUIDs, integers/decimals, hex ids, quoted literals, emails,
  file line/col numbers → replace with placeholders (<uuid>, <num>, <id>, <str>).
signature = normalise(message)
          + "|" + (error_code || "")
          + "|" + (route_pattern || "")
          + "|" + (top_stack_frame_normalised || "")
fingerprint = sha256(signature)
```

Same fingerprint = same bug. Route + code + top frame keep distinct bugs distinct even when messages collide.

#### Upsert + auto-reopen (the Kaizen loop) — do it in the service inside a transaction

```
BEGIN
  SELECT group by fingerprint FOR UPDATE
  if not found:
    INSERT group (status=open, count=1, first_seen=last_seen=now, sample=ctx, severity, ...)
  else:
    UPDATE count=count+1, last_seen=now, sample=ctx
    if status = 'resolved':
        status='open', reopened_at=now, reopen_count=reopen_count+1   -- REGRESSION
        -> raise 'error_group_reopened' event  (feeds alerts + socket)
    -- 'ignored' groups stay ignored (still counted) — muted on purpose
  INSERT occurrence(group_id, ...redacted...)
  emit 'error_captured' (and 'error_group_new' when newly inserted or reopened)
COMMIT
```

`FOR UPDATE` (or `INSERT ... ON CONFLICT (fingerprint) DO UPDATE`) prevents a race from creating duplicate groups under a burst.

#### Browse / resolve / export API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/errors?status=open&severity=&source=&q=&page=1&page_size=30` | paginated groups, newest `last_seen` first. **30/page default.** |
| GET | `/errors/:groupId` | group + its recent occurrences (paginated) |
| POST | `/errors/resolve` | body `{ group_ids: [...], note? }` → **multi-select resolve.** Sets `status='resolved'`, `resolved_at`, `resolved_by`, disappears from default (open) list. Audit-logged. |
| POST | `/errors/ignore` | body `{ group_ids: [...] }` → mute (still counts, never alerts) |
| POST | `/errors/reopen` | manual reopen |
| GET | `/errors/export?status=open&severity=&...` | **Markdown export** of the current filtered set (see below) |

**Markdown export — `errors.export.js`.** Returns `Content-Type: text/markdown` with `Content-Disposition: attachment; filename="kaizen-errors-<date>.md"`. Format:

```markdown
# Kaizen Error Report — 2026-07-06 14:30 WAT
Filter: status=open, severity>=error   •   142 groups

## 1. [CRITICAL] TypeError: cannot read 'total' of undefined
- **Fingerprint:** a1b2c3…
- **Route:** POST /api/v1/sales/:id/pay   •   **Status:** 500
- **Occurrences:** 512   •   **First seen:** 2026-07-01 09:12   •   **Last seen:** 2026-07-06 14:22
- **Source:** backend
- **Sample stack:**
  ```
  at computeTotal (src/modules/sales/sales.service.js:212)
  ...
  ```
---
## 2. …
```

This is what we paste into a fix ticket or send to the client as evidence.

### 7.4 Health checks

`health.service.js` runs probes and both (a) answers `GET /api/v1/kaizen/health/current` on demand and (b) is called every minute by the health-tick scheduler to persist snapshots (for trend lines + alerting).

Probes:
- **db** — `SELECT 1` timing against the existing pool (`src/config/database.js`).
- **redis** — `PING` via `src/config/redis.js`.
- **queue** — BullMQ per-queue counts (waiting/active/failed/delayed) via the queue names in `worker.js`. `degraded` if failed>threshold or waiting backlog is high.
- **disk** — free space on the data + backup partitions (`statvfs` via `check-disk-space` or `df` shell-out). `degraded`<15% free, `down`<5%.
- **memory / cpu** — `os.freemem/totalmem`, `os.loadavg()`.
- **backup** — freshness: last `kaizen_backup_runs` success per kind. `degraded` if the newest daily success is >26h old; `down` if >50h.
- **restore_drill** — freshness + last result: `degraded` if last drill >8 days or failed.

Also **enhance the existing `/health`** in `src/routes/index.js` to an optional `?deep=1` that returns db/redis booleans (keep the default cheap `{ok:true}` for load-balancer probes). Add a `GET /api/v1/kaizen/health/history?component=&hours=24` for charts.

### 7.5 Performance metrics

**`perf.middleware.js`** — install early in `src/server.js` (after `request-id`, before routers). It records `route pattern + method + duration + status` on `res.on('finish')`. Keep it cheap: accumulate into an **in-memory ring buffer / per-route reservoir**, and the health-tick scheduler flushes **1-minute rollups** (`p50/p95/p99/max/count/err_count`) into `kaizen_perf_rollups`. Use Express's `req.route?.path` + `req.baseUrl` to derive the pattern (so `/sales/123/pay` → `/api/v1/sales/:id/pay`), falling back to a coarse bucket. Never store per-request rows (too much volume) — rollups only.

Endpoints: `GET /perf/summary?hours=24` (top slow routes, overall p95, error rate, throughput), `GET /perf/route?pattern=&hours=`.

Optional (nice-to-have, flag it): if `pg_stat_statements` is enabled, expose top slow queries at `GET /perf/slow-queries`. If the extension isn't present, return an empty set with a hint — do not hard-fail.

### 7.6 Backup subsystem

#### Transport: rclone (universal) + rclone crypt (encryption)

We do **not** hand-write cloud SDK adapters. `rclone` is configured once on the server (`rclone config`) to define:
1. A base remote to the provider — for v1, Google Drive on Tom's account: remote name `gdrive`.
2. A **crypt** remote wrapping it — `gdrive-crypt:` — so filenames + contents are encrypted at rest. The DB dump (with real customer data) is therefore never plaintext in Drive.

**Switching providers later** (S3 / OneDrive / another Google account) = run `rclone config` to add the new remote, then change the destination's `rclone_remote` in Kaizen settings. **No code change.** That directly answers "what if we move off Google Drive."

`destinations/rclone.js` is a thin wrapper that shells out (via `execFile`, never string-concatenated `exec`) to:
- `rclone copyto <localfile> <remote>:<path>` — upload
- `rclone lsjson <remote>:<path>` — list
- `rclone delete <remote>:<path>` — prune
- `rclone about <remote>:` — free/used space (feeds the "Drive is 92% full" health check)
- `rclone cat`/`copyto` (download) — for restore drills

`destinations/local.js` implements the same interface against a local directory (no rclone needed) — used as a fallback and as a staging area.

#### Logical backup — `logical-backup.js` (runs in the worker, `02:30`)

Steps (each step's output is captured to `kaizen_backup_runs.log`, and any failure marks the run `failed` with `error`):

1. Create a run row (`status='running'`, `kind='logical_bundle'`, `trigger`).
2. **Database:** `pg_dump -Fc` (custom format, compressed, all 3 schemas) using `config.DB_*`. Write to `KAIZEN_BACKUP_STAGING_DIR/db-<ts>.dump`. (Set `PGPASSWORD` in the child env; use `execFile` with an args array.)
3. **Uploads/media:** `tar -czf uploads-<ts>.tgz` of `uploads/` and `media/` (paths from config / repo root).
4. **Config:** `tar -czf config-<ts>.tgz` of `.env`, `ecosystem.config.js`, and nginx site files (readable copies). *(`.env` holds secrets — this is why the crypt remote is mandatory.)*
5. Combine into one `.tar` (or upload the three separately under a dated folder). Compute **sha256** of each artifact → `checksum`.
6. `rclone copyto` each artifact to `<remote>:<path_prefix>/logical/YYYY/MM/DD/…`.
7. **Verify** the upload: `rclone lsjson` the target and confirm size matches; optionally `rclone check`.
8. Update run: `status='success'`, `finished_at`, `duration_ms`, `size_bytes`, `artifact_key`, `checksum`. Delete local staging (keep the most recent N locally per retention).
9. Emit `backup_completed` / `backup_failed` events (feed alerts).

> **Codebase is already in git** — restic + this config backup cover the rest, so we do not separately archive source.

#### Full-volume backup — `fullvolume-backup.js` (worker triggers at `03:00`; imaging runs as root)

Node **cannot** image a live disk from inside the process. So:

- **Actual imaging** is done by **`restic`** (encrypted, deduplicated, incremental) with an **rclone backend** pointing at the same Drive. It runs as **root** via a system cron **and** can be triggered on demand by Kaizen through a **sudoers-whitelisted wrapper** (`ops/kaizen/kaizen-fullbackup.sh`). restic backs up the whole server volume (OS config, installed packages list, `/var/www`, uploads, nginx, etc.), excluding volatile paths (`/proc`, `/sys`, `/tmp`, `node_modules`, the staging dir).
- **Kaizen's role** = cockpit: on trigger, the worker calls `sudo /usr/local/bin/kaizen-fullbackup` (whitelisted, NOPASSWD, that exact command only). The wrapper writes a machine-readable status file `KAIZEN_RESTIC_STATUS_JSON` (`/var/backups/kaizen/last-full.json`) on completion. The worker reads it, and also runs read-only `restic snapshots --json` (with `RESTIC_REPOSITORY` + `RESTIC_PASSWORD` from env) to populate `kaizen_backup_runs` (`kind='full_volume'`, `artifact_key=<snapshot id>`).
- **Re-run of a failed full-volume backup** from the UI = the same trigger path.

restic dedup means only *changed* blocks upload nightly — critical when the media library is large (a full re-upload of hundreds of GB every night is not viable over a home/office uplink).

#### Trigger & re-run API — `backups.controller.js`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/backups/runs?kind=&status=&page=&page_size=` | ledger, newest first |
| GET | `/backups/runs/:id` | run detail + log |
| POST | `/backups/run` | body `{ kind }` → **manual trigger** (enqueues a job; `trigger='manual'`) |
| POST | `/backups/runs/:id/rerun` | **re-run a failed backup** (`trigger='rerun'`) |
| GET | `/backups/destinations` / POST / PATCH | manage destinations (name/remote/prefix/default). **No secrets here.** |
| GET | `/backups/status` | dashboard summary: last success per kind, next scheduled, storage free (via `rclone about`), last restore drill |

All triggers/reruns are audit-logged and, being long-running, execute in the **worker** via a BullMQ job (`kaizen-backup` queue) — the controller enqueues and returns immediately; progress streams via Socket.io.

#### Retention

Config in `kaizen_settings` (`backup.retention`): keep e.g. **7 daily, 4 weekly, 6 monthly** for logical; restic uses `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune` in the wrapper. The hourly maintenance tick prunes logical artifacts on the remote (`rclone delete`) beyond policy and deletes their `kaizen_backup_runs`… no — **keep the run rows** (they're the audit trail); only delete the artifacts, and mark the row `artifact_key=null, detail.pruned=true`.

### 7.7 Restore drills & restore runbook

#### Automated restore drill — `restore-drill.js` (worker, Sun `04:00`)

This is how we **prove** backups restore and **measure** recovery time (so the client SLA is honest).

1. Create a `kaizen_restore_drills` row (`status='running'`).
2. Find the latest successful `logical_bundle` run.
3. **Download** its DB dump from the remote via rclone into staging (this exercises the *off-site copy*, end-to-end).
4. Create a scratch database `kaizen_restore_scratch` (drop-if-exists first).
5. `pg_restore` into it; **time the whole download+restore**.
6. **Assertions:** row counts on canary tables (`shared.users`, `shared.contacts`, `pixiegirl.<a core table>`, `faitlynhair.<a core table>`), presence of a known record, `SELECT count(*)` sanity vs. expected ranges stored in `kaizen_settings`. Record each as `{check, expected, got, ok}`.
7. Set `status='pass'|'fail'`, `duration_ms`, `restored_row_counts`, `assertions`.
8. Drop the scratch DB. Emit event → on `fail`, fire a critical alert.

Kaizen surfaces the badge: **"✅ Last verified restore: 3 days ago — took 41 min"** (or a red badge on fail/stale). **We quote the client the measured number**, with margin.

> **Honest SLA note for the team:** the 120-minute recovery promise is realistic for *data* restore **if** a fresh server can be provisioned quickly and the download fits the window. The usual bottleneck is provisioning + transfer time — a very large media library can exceed 120 min on download alone. Mitigations we should evaluate once drills give us real numbers: keep restic dedup tight, colocate storage, or run a warm standby. **Do not quote 120 min until a drill (or a real rehearsal on a fresh box) confirms it.**

#### Restore runbook (guarded, manual for v1)

Restore-to-production is intentionally **not** a UI button in v1 (a misclick could wipe live data). Ship `ops/kaizen/RESTORE_RUNBOOK.md` and expose downloadable artifacts in the UI. The runbook covers: provision a fresh box → install deps (Node, Postgres 16, Redis, nginx) → `rclone`/`restic` restore of the volume **or** `pg_restore` the logical dump + untar uploads/config → run migrations verify (`npm run db:verify` expects 425 tables) → smoke test → cut DNS over. See §14.

### 7.8 Notifications & alert rules

`alerts.service.js` evaluates `kaizen_alert_rules` (some event-driven, some polled by the hourly tick) and, on a match, creates a `kaizen_alerts` row and dispatches to channels. **Channels in v1: `email` + `in_dash` only.** Reuse `src/services/email.service.js`. In-dashboard = insert the alert + push over Socket.io to operators.

Seed default rules (in `000305` or a small seeder):
- `error_new_critical` → critical error group created/reopened.
- `error_spike` → `{count:20, window_min:5}` occurrences for one group.
- `backup_failed` → any run `failed`.
- `restore_drill_failed` → drill `fail`.
- `health_degraded` → any component `down`, or `degraded` sustained 3 ticks.
- `disk_low` → `{free_pct:15}`.

**Dedupe:** compute `dedupe_key` (e.g. `rule + source_ref`) and suppress duplicates within a window (e.g. 1h) to avoid alert storms. Recipient emails live in `kaizen_settings` (`alerts.recipients`, defaulting to the active operators' emails).

### 7.9 Realtime

Reuse the existing Socket.io setup (`src/config/socket.js`, `src/realtime/`). Add a **Kaizen namespace/room** authorised by the **Kaizen JWT** (not platform auth): `kaizen:ops`. Emit:
- `error:new`, `error:reopened` (critical only, to keep it a signal)
- `backup:progress`, `backup:done`, `backup:failed`
- `health:changed`
- `alert:new`

Events originate from `kaizen.events.js` subscribers (services emit domain events; the events file translates them to socket emits — controllers never emit directly, matching the app convention).

### 7.10 Scheduler & worker wiring

Register in `src/jobs/worker.js` using the existing `withCronLock` (so nothing double-runs across instances) and `node-cron` in `Africa/Lagos`:

```js
const { withCronLock } = require("./cron-lock");
const cron = require("node-cron");

cron.schedule("30 2 * * *", () => withCronLock("kaizen-logical-backup",
  () => require("./schedulers/kaizen-logical-backup").run()), { timezone: "Africa/Lagos" });

cron.schedule("0 3 * * *", () => withCronLock("kaizen-fullvolume-backup",
  () => require("./schedulers/kaizen-fullvolume-backup").run()), { timezone: "Africa/Lagos" });

cron.schedule("0 4 * * 0", () => withCronLock("kaizen-restore-drill",
  () => require("./schedulers/kaizen-restore-drill").run()), { timezone: "Africa/Lagos" });

cron.schedule("* * * * *", () => withCronLock("kaizen-health-tick",
  () => require("./schedulers/kaizen-health-tick").run()), { timezone: "Africa/Lagos" });

cron.schedule("0 * * * *", () => withCronLock("kaizen-maintenance-tick",
  () => require("./schedulers/kaizen-maintenance-tick").run()), { timezone: "Africa/Lagos" });
```

Also add a BullMQ queue `kaizen-backup` (mirror the pattern in `worker.js`) so manual triggers/reruns run as jobs, and attach the `failed` capture listener to every worker.

**Retention pruning** and **occurrence pruning** run in `kaizen-maintenance-tick`: keep occurrences for N days (config, default 30) and cap per-group (e.g. last 200); keep health snapshots 30d, perf rollups 90d.

---

## 8. Frontend — `apps/kaizen`

### Scaffold

Clone `apps/admin` and strip it to the Kaizen shell. Same stack & versions (React 18, Vite 5, TanStack Query v5, Zustand 4, React Router 6, socket.io-client 4, recharts, framer-motion, lucide-react, tailwind). Path alias `@` → `apps/kaizen/src`. Vite dev proxy `/api` and `/media` → `http://localhost:7000` (copy `apps/admin/vite.config.ts`, drop the landing-kit alias you don't need).

`apps/kaizen/package.json` name: `@pixie-girl-hub/kaizen`. Scripts identical to admin (`dev`/`build`/`preview`/`lint`).

### Design / theme (distinct "ops" skin)

Follow the design canon in `docs/FRONTEND_INSTRUCTION_MUST_READ.md` (token-based, glassmorphism, Playfair/Montserrat/JetBrains Mono, four states on every screen, mobile-first) — **but** ship a **distinct Layer-A ops theme** so it's unmistakably the maintenance console, not the client admin. Recommended: near-black background with an **amber/signal-red** accent for alarms (green/amber/red status semantics throughout), reusing the existing token architecture (never inline a hex — define ops tokens). Keep money/number figures in JetBrains Mono for consistency.

### Client state / auth

- **Auth store (Zustand):** Kaizen access token in memory; refresh via the httpOnly cookie. Never localStorage. On `must_change_password`, force the change-password screen before anything else.
- **Server state:** TanStack Query v5. Query keys namespaced `['kaizen', ...]`. Mutations invalidate. **No `X-Brand-Context` header** — Kaizen is cross-cutting (this is a deliberate difference from admin).
- **Realtime:** connect to the `kaizen:ops` socket room with the Kaizen JWT; on `error:new`/`backup:*`/`alert:new`, invalidate the relevant queries and toast.

### Pages / routes

| Route | Screen | Notes |
| --- | --- | --- |
| `/login` | Operator login | + forced change-password |
| `/accept-invite` | Set password from invite token | public |
| `/` | **Overview** | health tiles (db/redis/queue/disk/mem/cpu), last backup + last verified restore badges, open-error count by severity, perf p95 sparkline, active alerts |
| `/errors` | **Errors** | table, **30/page**, filters (status/severity/source/search), **multi-select → Resolve/Ignore**, **Export Markdown** button. Resolved rows leave the default view. Live badge on new criticals. |
| `/errors/:id` | Error detail | group meta, occurrence timeline, stack, redacted context, resolve/reopen, first/last seen, reopen history |
| `/backups` | **Backups** | runs ledger (kind/status/size/duration/when), **Run now** + **Re-run** buttons (guarded), storage-free meter, destinations management, restore-drill history + "✅ verified" badge |
| `/health` | Health | per-component history charts (recharts), current status |
| `/performance` | Performance | top slow routes, p50/p95/p99, error rate, throughput, queue depth/failed jobs |
| `/alerts` | Alerts | active/acknowledged list, acknowledge, rule management |
| `/operators` | Operators | list, **Invite by email**, disable (guarded) |
| `/settings` | Settings | retention policy, alert recipients, default destination, ingest key display |

Every screen implements the canon's **four states**: loading skeleton, empty (with CTA), error (with retry). (Permission-denied is moot — all operators are admins.)

### Frontend error self-reporting

Add a global `ErrorBoundary` + `window.onerror`/`onunhandledrejection` hook in **all** client apps (admin, storefront, stylist, landing — and Kaizen itself) that POSTs to `/api/v1/kaizen/ingest/client-error` with `X-Kaizen-Ingest-Key`. This is how frontend crashes show up in Kaizen. Redact before sending.

---

## 9. Environment variables

Add to `src/config/env.js` (Zod schema) and document in `.env.example`. **No secret values in the repo.**

| Var | Example | Purpose |
| --- | --- | --- |
| `KAIZEN_JWT_SECRET` | (random 64+ chars) | signs Kaizen operator access tokens (separate from platform `JWT_SECRET`) |
| `KAIZEN_JWT_ACCESS_TTL` | `15m` | access token lifetime |
| `KAIZEN_REFRESH_TTL_DAYS` | `14` | refresh session lifetime |
| `KAIZEN_INGEST_KEY` | (random) | shared key for frontend error ingest |
| `KAIZEN_INGEST_ALLOWED_ORIGINS` | `https://admin.pixiegirlglobal.com,https://pixiegirlglobal.com` | ingest CORS allowlist |
| `KAIZEN_BASE_URL` | `https://kaizen.pixiegirlglobal.com` | for invite links / cookie domain |
| `KAIZEN_BACKUP_STAGING_DIR` | `/var/backups/kaizen/staging` | local staging for logical backups |
| `KAIZEN_RCLONE_BIN` | `/usr/bin/rclone` | rclone path |
| `KAIZEN_RCLONE_REMOTE` | `gdrive-crypt:` | default crypt remote |
| `KAIZEN_RCLONE_PATH_PREFIX` | `pixiegirl-hub/backups` | folder in the remote |
| `KAIZEN_RESTIC_BIN` | `/usr/bin/restic` | restic path (read-only status from Node) |
| `KAIZEN_RESTIC_REPOSITORY` | `rclone:gdrive:pixiegirl-hub/restic` | restic repo (via rclone) |
| `KAIZEN_RESTIC_PASSWORD` | (secret) | restic repo password (also in the root wrapper) |
| `KAIZEN_RESTIC_STATUS_JSON` | `/var/backups/kaizen/last-full.json` | wrapper writes; Node reads |
| `KAIZEN_FULLBACKUP_CMD` | `/usr/local/bin/kaizen-fullbackup` | sudoers-whitelisted trigger |
| `KAIZEN_SCRATCH_DB` | `kaizen_restore_scratch` | restore-drill scratch DB name |
| `KAIZEN_BACKUP_RETENTION` | `7d/4w/6m` | (or store in `kaizen_settings`) |
| `KAIZEN_ALERT_RECIPIENTS` | `tom.asaah@jbspraxis.com` | default alert emails (or in settings) |
| `KAIZEN_CAPTURE_4XX` | `false` | whether to capture 4xx as errors |

Use `zBool(...)` for booleans (the codebase deliberately avoids `z.coerce.boolean()` — see the note in `env.js`). Add `KAIZEN_*` under a clearly commented block.

---

## 10. Infrastructure & deployment

The Kaizen SPA is a **static build served by nginx** (exactly like the admin app — note it's not in `ecosystem.config.js`). The API is the existing Node backend on `127.0.0.1:7000`. The worker (already running via `npm run workers:start` / PM2) picks up the new schedulers.

### 10.1 Cloudflare — create the subdomain

`pixiegirlglobal.com` is managed in Cloudflare (same zone the ERP uses). To add `kaizen.pixiegirlglobal.com`:

1. Cloudflare dashboard → select the **`pixiegirlglobal.com`** zone → **DNS → Records → Add record**.
2. **Type** `A` (or `CNAME`).
   - `A`: **Name** `kaizen`, **IPv4** = the same origin server IP the ERP/admin uses (copy from the existing `admin`/root record).
   - or `CNAME`: **Name** `kaizen`, **Target** = the existing hostname the other apps point to (e.g. `@` / the origin hostname).
3. **Proxy status: Proxied (orange cloud)** — keeps Cloudflare's TLS, WAF, and caching in front (same as the other subdomains).
4. Save. Propagation is seconds-to-minutes on Cloudflare.
5. **SSL/TLS mode:** ensure the zone is **Full (strict)** (it already is for the other apps). The origin must present a valid cert — use the existing **Cloudflare Origin Certificate** installed on nginx (add `kaizen.pixiegirlglobal.com` to its host list, or reuse the wildcard `*.pixiegirlglobal.com` origin cert if one exists). If you use Let's Encrypt at the origin instead, issue/expand the cert to include the new host (see 10.2).
6. (Optional, recommended) Cloudflare **Access** policy on `kaizen.pixiegirlglobal.com` restricting to JBS Praxis emails — a second lock in front of the app login. Nice-to-have.
7. Confirm: `dig kaizen.pixiegirlglobal.com` resolves and `curl -I https://kaizen.pixiegirlglobal.com/health` returns 200 once nginx is configured.

### 10.2 nginx server block

`ops/kaizen/nginx-kaizen.conf` (adapt paths to the box; mirror the existing admin site block):

```nginx
server {
    listen 443 ssl http2;
    server_name kaizen.pixiegirlglobal.com;

    # Reuse the Cloudflare Origin Cert (or wildcard) already on this box
    ssl_certificate     /etc/ssl/pixiegirlglobal/origin.pem;
    ssl_certificate_key /etc/ssl/pixiegirlglobal/origin.key;

    root /var/www/pixie-girl-hub/apps/kaizen/dist;
    index index.html;

    # SPA
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API + media → Node backend
    location /api/  { proxy_pass http://127.0.0.1:7000; include /etc/nginx/proxy_params; }
    location /media/{ proxy_pass http://127.0.0.1:7000; include /etc/nginx/proxy_params; }

    # Socket.io (websocket upgrade)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    client_max_body_size 20m;
}
# Redirect http→https (Cloudflare usually handles this, but keep for direct origin hits)
server { listen 80; server_name kaizen.pixiegirlglobal.com; return 301 https://$host$request_uri; }
```

Enable: symlink into `sites-enabled`, `nginx -t`, `systemctl reload nginx`.

> **CORS:** because the SPA and API are same-origin (`/api` proxied under the kaizen host), no CORS is needed for operator calls. The **ingest** endpoint (called from *other* origins like the admin/storefront hosts) needs the `KAIZEN_INGEST_ALLOWED_ORIGINS` allowlist handled in Express.

### 10.3 Build & PM2

```bash
# Backend: migrations + restart (worker picks up schedulers)
npm install
npm run db:migrate:shared            # applies 000301–000306
node scripts/kaizen-create-operator.js   # seed Tom (password via env/prompt, NOT committed)
pm2 restart pixie-girl-hub               # API
pm2 restart <worker process>             # worker (or ENABLE_WORKERS path)

# Frontend
cd apps/kaizen && npm install && npm run build   # → apps/kaizen/dist
# nginx already serves dist; just reload if the block is new
```

No new PM2 app is required (static SPA). Confirm the worker is running the Kaizen crons (`pm2 logs` should show the tick registrations).

### 10.4 System-level: rclone + restic + cron + sudoers

Done **once** on the origin server. Requires root/SSH — Tom confirmed this is available.

**1. Install tools**
```bash
curl https://rclone.org/install.sh | sudo bash
sudo apt-get install -y restic postgresql-client-16     # pg_dump/pg_restore for the running PG major
```

**2. Configure rclone remotes (interactive, once)**
```bash
rclone config
#  → n) new remote  name: gdrive   storage: drive (Google Drive)
#     Follow OAuth: on a headless box use `rclone authorize "drive"` from a
#     desktop browser and paste the token back. Authorize with TOM'S Google
#     account (the one with the 2TB Google One / Gemini storage).
#  → n) new remote  name: gdrive-crypt  storage: crypt
#     remote: gdrive:pixiegirl-hub/backups     (encrypt filenames + data)
#     set a strong crypt password (store it in the password manager, NOT the repo)
rclone about gdrive:            # sanity: shows total/used/free of the 2TB
rclone mkdir gdrive-crypt:      # init the encrypted path
```
> **Swapping providers later:** `rclone config` a new remote (e.g. `s3`, `onedrive`, or another `drive`), optionally wrap it in a new crypt remote, then change the destination's `rclone_remote` in Kaizen **Settings**. No redeploy.

**3. Initialise the restic repository (full-volume, encrypted, dedup)**
```bash
export RESTIC_REPOSITORY="rclone:gdrive:pixiegirl-hub/restic"
export RESTIC_PASSWORD="<strong-restic-password>"     # store in password manager + env
restic init
```

**4. Root wrapper — `ops/kaizen/kaizen-fullbackup.sh` → `/usr/local/bin/kaizen-fullbackup`** (chmod 750, root-owned):
```bash
#!/usr/bin/env bash
set -euo pipefail
export RESTIC_REPOSITORY="rclone:gdrive:pixiegirl-hub/restic"
export RESTIC_PASSWORD_FILE="/root/.kaizen/restic.pass"
STATUS="/var/backups/kaizen/last-full.json"
mkdir -p "$(dirname "$STATUS")"
start=$(date +%s)
if restic backup / \
     --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/run \
     --exclude=/tmp --exclude=/var/backups/kaizen/staging \
     --exclude='**/node_modules' --json > /var/log/kaizen-fullbackup.log 2>&1; then
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune >> /var/log/kaizen-fullbackup.log 2>&1
  snap=$(restic snapshots --json | tail -c 4096)
  printf '{"status":"success","duration_s":%s,"finished":"%s"}\n' "$(( $(date +%s)-start ))" "$(date -Iseconds)" > "$STATUS"
else
  printf '{"status":"failed","duration_s":%s,"finished":"%s"}\n' "$(( $(date +%s)-start ))" "$(date -Iseconds)" > "$STATUS"
  exit 1
fi
```

**5. sudoers — `ops/kaizen/sudoers-kaizen` → `/etc/sudoers.d/kaizen`** (lets the app user trigger ONLY that command, no password):
```
# <app-user> may run only the Kaizen full-backup wrapper as root, nothing else
appuser ALL=(root) NOPASSWD: /usr/local/bin/kaizen-fullbackup
```
Validate with `visudo -cf /etc/sudoers.d/kaizen`.

**6. System cron (belt-and-braces so full-volume runs even if the worker is down) — `/etc/cron.d/kaizen-restic`:**
```
0 3 * * * root /usr/local/bin/kaizen-fullbackup
```
> If you prefer the worker to be the sole trigger, skip the cron and rely on `kaizen-fullvolume-backup.js` calling `sudo /usr/local/bin/kaizen-fullbackup`. Running both is harmless (restic dedup) but you may get two snapshots/day — pick one. **Recommendation: worker triggers it** (so Kaizen owns the schedule and status), keep the system cron **disabled/commented** as a documented fallback.

**7. Verify** with `node scripts/kaizen-setup-check.js` — asserts `rclone`, `restic`, `pg_dump`, the remote (`rclone about`), the restic repo (`restic snapshots`), and the sudoers trigger are all reachable; prints a green/red checklist.

---

## 11. Security considerations

- **Hard identity boundary.** Kaizen operators are a separate table with a separate JWT secret and `aud:"kaizen"`. A platform user token must never authenticate a Kaizen route. Verify this with a test.
- **No password in git.** The seed script takes the password from env/prompt; `must_change_password=true`. Invite tokens stored hashed.
- **PII redaction** at capture (server + client). Opaque, salted user references — never raw user ids/emails in error rows.
- **Backups encrypted at rest** — `rclone crypt` for logical, restic's native encryption for full-volume. `.env` (secrets) only ever leaves the box inside an encrypted artifact.
- **Least-privilege sudo** — the app user can run exactly one root command (the wrapper), nothing else.
- **Ingest endpoint** guarded by a static key + origin allowlist + strict rate limit + payload cap; it accepts no code execution, only structured error text (still redacted/scrubbed).
- **Destructive-action guards + audit log** on resolve/disable/backup-delete/restore.
- **Cloudflare Access** (optional) as an outer gate.
- **Secrets storage:** `KAIZEN_JWT_SECRET`, `KAIZEN_RESTIC_PASSWORD`, rclone crypt password, `KAIZEN_INGEST_KEY` live in `.env` / a password manager — never committed. Rotate if ever exposed.
- **Do not** widen the existing `/health` to leak internal detail unauthenticated — deep health is behind operator auth; the public `/health` stays a bare `{ok:true}`.

---

## 12. Testing & acceptance criteria

Backend unit tests with Jest (mirror `tests/unit/**`). Integration tests behind `RUN_DB_TESTS=1`. **Definition of done per feature:**

**Auth & operators**
- [ ] Seed script creates Tom as `active`, `must_change_password=true`; no password in any tracked file.
- [ ] Login returns access token + refresh cookie; forced password change works.
- [ ] Invite → email sent → accept-invite activates a new operator.
- [ ] A platform (`shared.users`) JWT is **rejected** on every `/api/v1/kaizen/*` route.
- [ ] Disable operator is guarded, audited, and revokes sessions.

**Errors**
- [ ] Two occurrences of the same normalised error collapse to one group with `count=2`.
- [ ] Distinct routes/codes produce distinct groups.
- [ ] Resolving via multi-select removes groups from the default (open) list and audits it.
- [ ] A new occurrence of a **resolved** group **auto-reopens** it (`reopened_at` set, `reopen_count++`) and fires an alert.
- [ ] List defaults to 30/page with working pagination + filters.
- [ ] Markdown export returns a downloadable, well-formed `.md` of the current filter.
- [ ] No PII (emails/phones/body values/tokens) appears in any stored occurrence — assert against a crafted request.
- [ ] A thrown error in `captureError` never breaks the original request (inject a failing DB and confirm the API still responds).
- [ ] Frontend ingest works with the key and is rejected without it / from a disallowed origin.

**Health & perf**
- [ ] `/health/current` returns per-component status; DB/Redis down is reflected as `down`.
- [ ] Snapshots persist each minute; history endpoint returns a series.
- [ ] Perf rollups populate; a deliberately slow route shows elevated p95.

**Backups**
- [ ] Logical backup produces DB dump + uploads + config, checksums them, uploads via rclone, verifies size, and records `success` with `size_bytes`/`duration_ms`.
- [ ] Artifacts in Drive are **encrypted** (verify filenames/content are not plaintext).
- [ ] A forced failure records `failed` with `error`; **re-run** succeeds and is marked `trigger='rerun'`.
- [ ] Full-volume trigger invokes the sudo wrapper, a restic snapshot appears, and the run row captures the snapshot id.
- [ ] `rclone about` free space feeds the storage meter + `disk_low`/drive-full alert.
- [ ] Retention prunes artifacts beyond policy but keeps the audit rows.

**Restore drill**
- [ ] Weekly drill downloads the latest dump, restores into scratch, runs assertions, times itself, records `pass`/`fail`, drops scratch DB.
- [ ] A corrupted/missing artifact yields `fail` + a critical alert.
- [ ] The Overview badge shows "last verified restore" + duration.

**Alerts**
- [ ] Each default rule fires on its trigger; email + in-dash both delivered; dedupe suppresses a storm.

**Infra**
- [ ] `kaizen.pixiegirlglobal.com` resolves, serves the SPA, proxies `/api` and websockets.
- [ ] `scripts/kaizen-setup-check.js` prints all-green on the deploy box.

---

## 13. Phased rollout plan

Ship in vertical slices so value lands early. Each phase is independently deployable.

- **Phase 0 — Foundations (subdomain + auth + shell).** Cloudflare record, nginx, `apps/kaizen` scaffold + ops theme, migrations `000301`, Kaizen auth + seed Tom + invite flow, empty Overview. *Outcome: we can log in at kaizen.pixiegirlglobal.com.*
- **Phase 1 — Errors.** Capture pipeline (all four points), fingerprinting, browse/resolve/reopen/export, frontend ingest + boundaries in the client apps. *Outcome: we see live, grouped errors.*
- **Phase 2 — Health & performance.** Probes, snapshots, perf middleware + rollups, Overview tiles + charts, health/perf alerts. *Outcome: we see the system's live state.*
- **Phase 3 — Backups.** rclone/restic setup, logical backup, full-volume trigger, ledger UI, manual run + re-run, retention, backup alerts. *Outcome: daily verified off-site backups we can see and re-run.*
- **Phase 4 — Restore drills + runbook.** Weekly drill, "verified restore" badge, `RESTORE_RUNBOOK.md`, a real rehearsal on a fresh box to measure and set the honest SLA. *Outcome: we can prove recovery.*
- **Phase 5 — Polish.** Alert rule management UI, settings, dedupe tuning, dashboards refinement.

*(Deferred, post-v1: AI health summaries; multi-client central console; one-click restore-to-prod.)*

---

## 14. Operational runbooks

Ship these under `ops/kaizen/` and link them in the Kaizen **Settings → Runbooks** page.

**A. Backup failed (alert received)**
1. Open Kaizen → Backups → the failed run → read `log`/`error`.
2. Common causes: Drive quota full (`rclone about`), OAuth token expired (`rclone about` errors → re-`rclone config reconnect gdrive:`), `pg_dump` version mismatch, disk full in staging.
3. Fix, then **Re-run** from the UI. Confirm success + checksum.

**B. Restore drill failed**
1. Backups → Restore drills → read assertions.
2. If the artifact is bad, verify the source backup; run a fresh logical backup and re-drill.
3. If restore itself errors, check `pg_restore` version / scratch DB perms.

**C. Disaster recovery (server lost) — measured, not guessed**
1. Provision a fresh box (same OS, Postgres 16, Redis, Node, nginx).
2. Install rclone + restic; `rclone config` the same `gdrive`/crypt remotes; set `RESTIC_*`.
3. **Full-volume restore:** `restic restore latest --target /` (or to a staging path then rsync). *or* **Logical restore:** create DB, `pg_restore` the latest dump, untar uploads + config.
4. `npm run db:verify` (expect 425 tables). Run smoke test.
5. Restore `.env` from the config artifact; `pm2 start ecosystem.config.js`.
6. Repoint DNS (Cloudflare) to the new box.
7. **Record the wall-clock time** — this is our real RTO; update the client SLA to match.

**D. Error triage (daily)**
1. Kaizen → Errors (open, sort by severity/last seen).
2. Investigate the top group; fix in the app repo; deploy.
3. Resolve the group in Kaizen. If it recurs, it auto-reopens — that's your regression signal.

---

## 15. Assumptions & open items

**Assumptions (flag if any are false before building):**
- The origin server is reachable via SSH with root/sudo (confirmed by Tom) — required for rclone/restic/cron/sudoers.
- Tom's Google account (2TB Google One via Gemini/AI Premium) will host backups initially; OAuth authorized once via `rclone config`. *Business risk noted:* a personal account can be quota-limited/suspended; treat Drive as primary-for-now and revisit dedicated storage as the client relationship formalises. Swapping is a config change.
- `pgcrypto` is enabled (for `gen_random_uuid()`); if not, enable it in the first Kaizen migration.
- The other subdomains already terminate TLS via a Cloudflare Origin Cert (or wildcard) on nginx that we can extend to `kaizen`.
- Postgres major version on the box matches the `pg_dump`/`pg_restore` client installed (use `postgresql-client-16`).

**Open items to confirm with Tom (none block Phase 0):**
- Exact origin server IP/hostname for the Cloudflare record.
- Whether to add a Cloudflare Access policy in front (recommended).
- Retention numbers (default proposed: 7 daily / 4 weekly / 6 monthly).
- The real recovery-time target to advertise — **set after Phase 4 measures it.**

---

## Appendix A — file-by-file build checklist

**Migrations:** `000301`–`000306` (§6).

**Backend — new:** everything under `src/modules/kaizen/**` (§5, §7), five schedulers in `src/jobs/schedulers/kaizen-*.js`, `scripts/kaizen-create-operator.js`, `scripts/kaizen-setup-check.js`.

**Backend — edits:**
- `src/routes/index.js` → `mountKaizen(app)`; add `?deep=1` to `/health`.
- `src/middleware/error-handler.js` → fire-and-forget `captureError` in the unhandled branch (and optionally translated-PG branch).
- `src/server.js` → install `perf.middleware`; `unhandledRejection`/`uncaughtException` capture; register the Kaizen socket namespace.
- `src/jobs/worker.js` → register five Kaizen crons via `withCronLock`; add `kaizen-backup` BullMQ queue; attach `failed` capture to every worker.
- `src/config/env.js` + `.env.example` → `KAIZEN_*` vars.

**Frontend — new:** `apps/kaizen/**` (cloned from `apps/admin`, ops theme, pages in §8). **Edits:** add error self-reporting (`ErrorBoundary` + `window.onerror` → ingest) to `apps/admin`, `apps/storefront`, `apps/stylist`, `apps/landing`.

**Ops — new:** `ops/kaizen/{nginx-kaizen.conf, kaizen-fullbackup.sh, sudoers-kaizen, kaizen-restic-cron, RESTORE_RUNBOOK.md, README.md}`.

**Deploy:** Cloudflare record (§10.1) → nginx (§10.2) → migrate + seed + build (§10.3) → rclone/restic/cron/sudoers (§10.4) → `kaizen-setup-check` green.

---

*End of guide. If anything here is ambiguous enough to stop you, raise it with Tom before improvising — but it is meant to be complete enough that you won't have to.*
