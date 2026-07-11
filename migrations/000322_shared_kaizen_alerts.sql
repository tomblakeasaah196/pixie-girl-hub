-- ============================================================================
-- Kaizen — Phase 5: alert rules + alerts.
--
-- Rules define WHAT to alert on; alerts are the fired instances (deduped within
-- a window to avoid storms). Channels in v1: email + in_dash only (per owner
-- decision D9). kaizen_settings already exists (created in Phase 3, 000321) —
-- do NOT recreate it here.
--
-- See docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md §6.5, §7.8.
-- ============================================================================

CREATE TABLE IF NOT EXISTS shared.kaizen_alert_rules (
  rule_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  condition_type TEXT        NOT NULL
                   CHECK (condition_type IN
                     ('error_new_critical','error_spike','backup_failed',
                      'health_degraded','restore_drill_failed','perf_p95_breach','disk_low')),
  threshold      JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- e.g. {"count":20,"window_min":5} or {"p95_ms":2000}
  channels       TEXT[]      NOT NULL DEFAULT ARRAY['email','in_dash'],
  enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One rule per condition_type (the seed set); UI toggles/edits rather than dupes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kaizen_rule_condition ON shared.kaizen_alert_rules (condition_type);

CREATE TABLE IF NOT EXISTS shared.kaizen_alerts (
  alert_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID        REFERENCES shared.kaizen_alert_rules(rule_id),
  kind            TEXT        NOT NULL,
  severity        TEXT        NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  title           TEXT        NOT NULL,
  body            TEXT,
  source_ref      TEXT,                              -- e.g. error group_id, backup run_id
  status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','acknowledged','resolved')),
  dedupe_key      TEXT,                              -- suppress duplicates within a window
  channels_sent   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by UUID        REFERENCES shared.kaizen_operators(operator_id),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_kaizen_alerts_status_time ON shared.kaizen_alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_kaizen_alerts_dedupe ON shared.kaizen_alerts (dedupe_key, created_at DESC);

-- Seed the default rule set (idempotent). Thresholds are the guide's defaults.
INSERT INTO shared.kaizen_alert_rules (name, condition_type, threshold) VALUES
  ('New critical error',      'error_new_critical',   '{}'::jsonb),
  ('Error spike',             'error_spike',          '{"count":20,"window_min":5}'::jsonb),
  ('Backup failed',           'backup_failed',        '{}'::jsonb),
  ('Restore drill failed',    'restore_drill_failed', '{}'::jsonb),
  ('Health degraded',         'health_degraded',      '{"sustained_ticks":3}'::jsonb),
  ('p95 latency breach',      'perf_p95_breach',      '{"p95_ms":2000}'::jsonb),
  ('Disk low',                'disk_low',             '{"free_pct":15}'::jsonb)
ON CONFLICT (condition_type) DO NOTHING;
