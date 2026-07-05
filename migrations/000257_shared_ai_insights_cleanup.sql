-- ============================================================
-- 000257 — AI Insights: legacy category-table cleanup + briefing refs unlock
-- Pixie Girl Hub · JBS Praxis · V2.2 §6.30
--
-- The unified insights store (000256, shared.ai_insights) has been the only
-- write path since the Wave-1 cutover, and is live in production. This
-- migration finishes the transition:
--
--   1. DROP the seven per-category tier-1 tables from 000012. Nothing in the
--      codebase reads or writes them any more (verified by grep before this
--      migration was authored); their open findings re-materialised into the
--      unified store on the first post-deploy sweep.
--
--   2. UNLOCK shared.ai_briefing_insight_refs for the unified module keys.
--      Its insight_category CHECK still enumerated the six original category
--      names ('stock','margin','invoice',…), which would reject unified module
--      keys like 'purchasing' or 'service_jobs'. The briefing generator now
--      populates this table (paragraph → alert links), storing the unified
--      `module` key — so the stale CHECK goes; the soft-FK design and the
--      indexes stay.
--
-- Idempotent: IF EXISTS everywhere. Re-runs are no-ops.
-- ============================================================

-- 1 ── Drop the legacy tier-1 category tables (superseded by shared.ai_insights)
DROP TABLE IF EXISTS shared.ai_insight_stock_alerts CASCADE;
DROP TABLE IF EXISTS shared.ai_insight_margin_breaches CASCADE;
DROP TABLE IF EXISTS shared.ai_insight_invoice_alerts CASCADE;
DROP TABLE IF EXISTS shared.ai_insight_intercompany_alerts CASCADE;
DROP TABLE IF EXISTS shared.ai_insight_attendance_anomalies CASCADE;
DROP TABLE IF EXISTS shared.ai_insight_approval_queue_alerts CASCADE;
DROP TABLE IF EXISTS shared.ai_insight_service_match CASCADE;

-- 2 ── ai_briefing_insight_refs: accept unified module keys
ALTER TABLE shared.ai_briefing_insight_refs
  DROP CONSTRAINT IF EXISTS ai_briefing_insight_refs_insight_category_check;
COMMENT ON COLUMN shared.ai_briefing_insight_refs.insight_category IS
  'Unified insight module key (shared.ai_insights.module), e.g. invoicing, stock, purchasing. Soft-FK: insight_id points into shared.ai_insights.';

-- ============================================================
-- Verify
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema='shared' AND table_name LIKE 'ai_insight_%';
-- Expected: 1 (ai_insight_modules only; the 7 category tables are gone)
-- ============================================================
