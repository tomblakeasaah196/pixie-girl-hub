-- ============================================================
-- 000259 — AI Insights: honour the per-module frequency cadence
-- Pixie Girl Hub · JBS Praxis · V2.2 §6.31
--
-- The AI Control matrix already stores a `frequency` per module
-- (realtime / daily / weekly / off), but the cron sweep ignored it — it
-- re-scanned every enabled module every 30 minutes regardless. So setting a
-- module to "weekly" to cut spend had no effect.
--
-- This adds `last_swept_at`: the cron sweep now records when it last ran a
-- module's detectors and gates the next automatic run on the module's
-- frequency (realtime → every tick, daily → once/24h, weekly → once/7d,
-- off → never auto-run). The manual "Run scan" button is unaffected — it
-- still covers every enabled module immediately (the CEO's do-it-now path).
--
-- ADDITIVE + SAFE: one nullable column, no table added (db:verify shared
-- table count is unchanged). NULL last_swept_at = "never swept" = due now, so
-- existing enabled modules scan on the very next tick after deploy.
-- ============================================================

ALTER TABLE shared.ai_insight_modules
  ADD COLUMN IF NOT EXISTS last_swept_at TIMESTAMPTZ;

COMMENT ON COLUMN shared.ai_insight_modules.last_swept_at IS
  'When the cron sweep last ran this module''s detectors. Gates the automatic '
  'frequency cadence (realtime/daily/weekly); NULL = never swept = due now. '
  'The manual Run-scan button ignores this and always scans every enabled module.';

-- ============================================================
-- Verify
-- SELECT module, frequency, last_swept_at FROM shared.ai_insight_modules
--   ORDER BY sort_order;
-- ============================================================
