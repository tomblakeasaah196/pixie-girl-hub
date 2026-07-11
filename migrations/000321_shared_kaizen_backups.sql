-- ============================================================================
-- Kaizen — Phase 3: off-site backups (logical + full-volume) + settings.
--
-- Node owns the LOGICAL backup (pg_dump + uploads + config → rclone crypt) and
-- the ledger/UI. restic+rclone own the heavy FULL-VOLUME imaging; Kaizen is the
-- cockpit (triggers, reads status, displays, re-runs). NO secrets live in these
-- tables — rclone/restic credentials live in the rclone config + env on the box.
--
-- kaizen_restore_drills is created here (it references backup runs) but the
-- weekly drill LOGIC lands in Phase 4.
--
-- kaizen_settings is a small singleton-ish key/value store (retention, alert
-- recipients, expected row-count ranges, …). Created here because retention
-- config is needed now; Phase 5 must NOT recreate it.
--
-- See docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md §6.4, §7.6, §7.7.
-- ============================================================================

CREATE TABLE shared.kaizen_backup_destinations (
  destination_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,               -- 'Google Drive (Tom)'
  kind           TEXT        NOT NULL CHECK (kind IN ('rclone','local')),
  rclone_remote  TEXT,                               -- e.g. 'gdrive-crypt:' (configured via `rclone config`)
  path_prefix    TEXT        NOT NULL DEFAULT 'pixiegirl-hub/backups',
  is_default     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  detail         JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- NON-secret metadata only
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Only one default destination at a time.
CREATE UNIQUE INDEX uq_kaizen_dest_default
  ON shared.kaizen_backup_destinations (is_default) WHERE is_default;

CREATE TABLE shared.kaizen_backup_runs (
  run_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT        NOT NULL CHECK (kind IN ('logical_db','logical_bundle','full_volume')),
  destination_id  UUID        REFERENCES shared.kaizen_backup_destinations(destination_id),
  status          TEXT        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','success','failed','canceled')),
  trigger         TEXT        NOT NULL DEFAULT 'scheduled'
                    CHECK (trigger IN ('scheduled','manual','rerun')),
  retention_class TEXT        NOT NULL DEFAULT 'daily'
                    CHECK (retention_class IN ('daily','weekly','monthly')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER,
  size_bytes      BIGINT,
  artifact_key    TEXT,                              -- rclone path OR restic snapshot id
  checksum        TEXT,                              -- sha256 for logical artifacts
  log             TEXT,                              -- tail of stdout/stderr
  error           TEXT,
  created_by      UUID        REFERENCES shared.kaizen_operators(operator_id),  -- null when scheduled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_backup_kind_time ON shared.kaizen_backup_runs (kind, started_at DESC);
CREATE INDEX ix_kaizen_backup_status    ON shared.kaizen_backup_runs (status, started_at DESC);

CREATE TABLE shared.kaizen_restore_drills (
  drill_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_run_id       UUID        REFERENCES shared.kaizen_backup_runs(run_id),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  duration_ms         INTEGER,
  status              TEXT        NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','pass','fail')),
  assertions          JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {check, expected, got, ok}[]
  restored_row_counts JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_drill_time ON shared.kaizen_restore_drills (started_at DESC);

-- Small settings store (retention, alert recipients, drill expectations, …).
CREATE TABLE shared.kaizen_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the retention policy (locked decision: 7 daily / 4 weekly / 6 monthly).
INSERT INTO shared.kaizen_settings (key, value) VALUES
  ('backup.retention', '{"daily":7,"weekly":4,"monthly":6}'::jsonb)
ON CONFLICT (key) DO NOTHING;
