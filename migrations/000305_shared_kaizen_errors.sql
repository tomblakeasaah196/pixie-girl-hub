-- ============================================================================
-- Kaizen — Phase 1: error capture store (grouped, PII-redacted).
--
-- One row per UNIQUE bug in kaizen_error_groups (grouped by fingerprint), with
-- bounded individual occurrences in kaizen_error_occurrences. The service
-- upserts by fingerprint and AUTO-REOPENS a resolved group when it recurs —
-- that regression signal is the core of the Kaizen loop.
--
-- NOTE ON NUMBERING: the guide (§6) proposed 000302–000306 for the later Kaizen
-- migrations, but 000302–000304 were already taken by unrelated migrations by
-- the time Phase 1 started, so Kaizen Phase 1 begins at 000305. One number =
-- one migration from here on.
--
-- See docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md §6.2, §7.3.
-- ============================================================================

-- One row per unique bug (grouped by fingerprint).
CREATE TABLE shared.kaizen_error_groups (
  group_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint       TEXT        NOT NULL,                 -- sha256 of normalised signature
  title             TEXT        NOT NULL,                 -- human summary (normalised message)
  error_code        TEXT,                                 -- AppError code / PG code / 'UNCAUGHT'
  source            TEXT        NOT NULL DEFAULT 'backend'
                      CHECK (source IN ('backend','worker','admin','storefront','stylist','landing','kaizen','unknown')),
  route_pattern     TEXT,                                 -- e.g. 'POST /api/v1/sales/:id/pay'
  http_status       INTEGER,
  severity          TEXT        NOT NULL DEFAULT 'error'
                      CHECK (severity IN ('info','warning','error','critical')),
  status            TEXT        NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','resolved','ignored')),
  occurrence_count  BIGINT      NOT NULL DEFAULT 0,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID        REFERENCES shared.kaizen_operators(operator_id),
  resolution_note   TEXT,
  reopened_at       TIMESTAMPTZ,                          -- set when a resolved group recurs
  reopen_count      INTEGER     NOT NULL DEFAULT 0,
  sample            JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- latest redacted context snapshot
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_kaizen_error_fingerprint ON shared.kaizen_error_groups (fingerprint);
CREATE INDEX ix_kaizen_error_status_last ON shared.kaizen_error_groups (status, last_seen_at DESC);
CREATE INDEX ix_kaizen_error_severity   ON shared.kaizen_error_groups (severity, last_seen_at DESC);
-- Partial index for the default (open) list — the hot query path.
CREATE INDEX ix_kaizen_error_open_last  ON shared.kaizen_error_groups (last_seen_at DESC)
  WHERE status = 'open';

-- Individual occurrences (retained bounded — pruned by the maintenance tick).
CREATE TABLE shared.kaizen_error_occurrences (
  occurrence_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID        NOT NULL REFERENCES shared.kaizen_error_groups(group_id) ON DELETE CASCADE,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id     TEXT,
  route          TEXT,
  method         TEXT,
  http_status    INTEGER,
  brand          TEXT,                                    -- pixiegirl/faitlynhair/null
  user_ref       TEXT,                                    -- opaque sha256(user_id+salt), NOT PII
  message        TEXT,
  stack          TEXT,
  context        JSONB       NOT NULL DEFAULT '{}'::jsonb  -- redacted (see §7.3 redaction rules)
);
CREATE INDEX ix_kaizen_occ_group_time ON shared.kaizen_error_occurrences (group_id, occurred_at DESC);
