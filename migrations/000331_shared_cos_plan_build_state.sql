-- ============================================================
-- MIGRATION 000331 — CoS: plan build state (resumable plan building)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- BUG: the CoS narrated full plans ("goal + 4 milestones + 6 tasks +
-- 3 events + a note") but the proposed plan carried only the steps the
-- model managed to emit in ONE completion — usually just the goal. The
-- output-token cap (finish_reason='length') and single-shot planning
-- silently dropped every remaining step, and the card then celebrated
-- "Plan completed" over a 1-step plan.
--
-- FIX (application layer, this column is the persistence for it):
-- cos.plan-rounds runs the model over MULTIPLE bounded rounds per turn,
-- feeding queued-step stubs back until the plan is fully emitted. When
-- the per-turn round/step budget still runs out first, the plan is
-- persisted with is_complete=false and the CEO gets a "Continue
-- building" action (POST /api/v1/cos/plans/:id/continue) that appends
-- the remaining steps to the SAME plan until it is complete.
--
-- Backfill: every existing plan predates resumable building — mark
-- complete so nothing sprouts a Continue button retroactively.
-- ============================================================

ALTER TABLE shared.ai_pending_plans
  ADD COLUMN IF NOT EXISTS is_complete BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN shared.ai_pending_plans.is_complete IS
  'false while the model still owes steps for this plan (per-turn build budget ran out); the CEO can keep building via POST /cos/plans/:id/continue. Plans are only executable as-is regardless — this flag only drives the Continue-building affordance.';

-- ============================================================
-- Verify
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_schema='shared' AND table_name='ai_pending_plans'
--      AND column_name='is_complete';   -- expect default true
-- ============================================================
