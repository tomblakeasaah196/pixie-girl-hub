-- ============================================================================
-- Kaizen — Phase 2: system health snapshots + performance rollups.
--
-- health_snapshots: one row per component per tick (1-minute cadence) so we can
--   draw trend lines and alert on sustained degradation.
-- perf_rollups: 1-minute per-route aggregates (p50/p95/p99/max/count/err_count).
--   We NEVER store per-request rows (too much volume) — only rollups.
--
-- See docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md §6.3, §7.4, §7.5.
-- ============================================================================

CREATE TABLE IF NOT EXISTS shared.kaizen_health_snapshots (
  snapshot_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  component    TEXT        NOT NULL,   -- db,redis,queue,disk,memory,cpu,backup,restore_drill
  status       TEXT        NOT NULL CHECK (status IN ('ok','degraded','down','unknown')),
  latency_ms   INTEGER,
  detail       JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_kaizen_health_comp_time ON shared.kaizen_health_snapshots (component, captured_at DESC);

CREATE TABLE IF NOT EXISTS shared.kaizen_perf_rollups (
  rollup_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  route_pattern TEXT        NOT NULL,
  method        TEXT        NOT NULL,
  req_count     INTEGER     NOT NULL DEFAULT 0,
  err_count     INTEGER     NOT NULL DEFAULT 0,
  p50_ms        INTEGER,
  p95_ms        INTEGER,
  p99_ms        INTEGER,
  max_ms        INTEGER
);
CREATE INDEX IF NOT EXISTS ix_kaizen_perf_window ON shared.kaizen_perf_rollups (window_start DESC);
CREATE INDEX IF NOT EXISTS ix_kaizen_perf_route  ON shared.kaizen_perf_rollups (route_pattern, window_start DESC);
