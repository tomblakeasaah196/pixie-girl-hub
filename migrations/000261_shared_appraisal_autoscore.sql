-- ============================================================
-- MIGRATION 000261 — Appraisal auto-scoring: brand-schema parity
-- Pixie Girl Hub · HR system audit follow-up (PR-B)
--
-- The performance appraisal tables live in the per-brand template
-- (template/000027_business_payroll.sql.template) and already carry every
-- column auto-scoring needs — auto_score_config, evidence, the auto-score
-- health fields, and the calibration fields. Brands provisioned from an older
-- template revision may be missing some of them, and their score_source CHECK
-- may predate the full source list. This migration brings every existing brand
-- schema up to parity, idempotently, so the auto-score engine can write
-- clock_in_data / sales_data / service_job_ratings / customer_ratings scores
-- with health + evidence on any brand.
--
-- No table is created or dropped — only columns/constraints are reconciled —
-- so the shared and per-brand table counts are unchanged.
-- ============================================================

DO $$
DECLARE
  r  RECORD;
  cc RECORD;
  SCORE_SOURCES CONSTANT TEXT :=
    '''manual'',''customer_ratings'',''sales_data'',''crm_data'',''service_job_ratings'',''clock_in_data'',''custom''';
  AUTO_STATUSES CONSTANT TEXT := '''ok'',''no_data'',''error'',''skipped''';
BEGIN
  -- ── performance_scores ────────────────────────────────────
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'performance_scores'
       AND table_schema NOT IN ('template')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.performance_scores
         ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT ''manual'',
         ADD COLUMN IF NOT EXISTS evidence JSONB,
         ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS last_auto_scored_at TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS last_auto_score_attempt_at TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS last_auto_score_status TEXT,
         ADD COLUMN IF NOT EXISTS last_auto_score_error TEXT,
         ADD COLUMN IF NOT EXISTS is_calibrated BOOLEAN NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS pre_calibration_score NUMERIC(5,2),
         ADD COLUMN IF NOT EXISTS calibration_reason TEXT',
      r.s
    );

    -- Reconcile the score_source CHECK to the full source list.
    FOR cc IN
      SELECT tc.constraint_name AS cname
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.table_schema = r.s
         AND tc.table_name = 'performance_scores'
         AND tc.constraint_type = 'CHECK'
         AND ccu.column_name = 'score_source'
    LOOP
      EXECUTE format('ALTER TABLE %I.performance_scores DROP CONSTRAINT %I', r.s, cc.cname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I.performance_scores
         ADD CONSTRAINT performance_scores_score_source_ck
         CHECK (score_source IN (%s))',
      r.s, SCORE_SOURCES
    );

    -- Reconcile the last_auto_score_status CHECK (NULL always allowed).
    FOR cc IN
      SELECT tc.constraint_name AS cname
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.table_schema = r.s
         AND tc.table_name = 'performance_scores'
         AND tc.constraint_type = 'CHECK'
         AND ccu.column_name = 'last_auto_score_status'
    LOOP
      EXECUTE format('ALTER TABLE %I.performance_scores DROP CONSTRAINT %I', r.s, cc.cname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I.performance_scores
         ADD CONSTRAINT performance_scores_auto_status_ck
         CHECK (last_auto_score_status IS NULL OR last_auto_score_status IN (%s))',
      r.s, AUTO_STATUSES
    );
  END LOOP;

  -- ── performance_kpi_definitions ───────────────────────────
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'performance_kpi_definitions'
       AND table_schema NOT IN ('template')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.performance_kpi_definitions
         ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT ''manual'',
         ADD COLUMN IF NOT EXISTS auto_score_config JSONB',
      r.s
    );

    FOR cc IN
      SELECT tc.constraint_name AS cname
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.table_schema = r.s
         AND tc.table_name = 'performance_kpi_definitions'
         AND tc.constraint_type = 'CHECK'
         AND ccu.column_name = 'score_source'
    LOOP
      EXECUTE format('ALTER TABLE %I.performance_kpi_definitions DROP CONSTRAINT %I', r.s, cc.cname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I.performance_kpi_definitions
         ADD CONSTRAINT performance_kpi_defs_score_source_ck
         CHECK (score_source IN (%s))',
      r.s, SCORE_SOURCES
    );
  END LOOP;
END $$;

-- ============================================================
-- No table count change (columns + CHECKs only). The template already carries
-- these fields, so freshly-provisioned brands are unaffected.
-- ============================================================
