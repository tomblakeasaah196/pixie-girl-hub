-- ============================================================
-- MIGRATION 000330 — CoS: exempt batch-plan steps from the
-- single-action confirm trigger
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- BUG: Approving any Chief-of-Staff batch plan failed with
-- HTTP 409 · code ACTION_BLOCKED (Postgres SQLSTATE P0001).
--
-- ROOT CAUSE: shared.fn_ai_pending_action_confirm_check() fires
-- BEFORE UPDATE OF status ON shared.ai_pending_actions and, when a
-- row moves proposed → confirmed, RAISEs unless confirmed_by_user_id
-- is set and the row is unexpired. That guard is the SINGLE-ACTION
-- Praxis confirm gate (praxis.service.confirmAction sets
-- confirmed_by_user_id in the same UPDATE and checks expiry first, so
-- it passes cleanly).
--
-- Batch-plan STEPS are ALSO ai_pending_actions rows — tagged with
-- plan_id / plan_step (see 000324). cos.plan-executor.confirmPlan
-- flips the still-proposed steps proposed → confirmed to reflect
-- intent on the board, WITHOUT a per-step confirmed_by_user_id, so
-- the trigger raised on the very first step and NO plan could ever
-- run. (Steps also default to a 30-minute expiry vs the plan's 60,
-- so the expiry branch could raise too.)
--
-- FIX: Batch-plan steps are governed by their PARENT plan
-- (shared.ai_pending_plans): the plan executor enforces ownership +
-- plan-level expiry + resumability in application code, and the plan
-- row carries its own confirmed_by_user_id / confirmed_at. The
-- per-step single-action guard therefore does not apply to plan
-- steps — exempt them (plan_id IS NOT NULL). Standalone Praxis
-- proposals (plan_id IS NULL) keep the guard byte-for-byte.
--
-- Only the function body changes; the trigger
-- trg_ai_pending_action_confirm_check (000014) is untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION shared.fn_ai_pending_action_confirm_check()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Batch-plan steps (plan_id IS NOT NULL) are confirmed as a batch through
  -- their parent plan (shared.ai_pending_plans), which carries confirmed_by_user_id
  -- and whose expiry + ownership are enforced by the Chief-of-Staff plan executor.
  -- The single-action confirm guard below governs ONLY standalone Praxis proposals.
  IF NEW.plan_id IS NULL
     AND NEW.status = 'confirmed' AND OLD.status = 'proposed' THEN
    IF OLD.expires_at < now() THEN
      RAISE EXCEPTION 'Cannot confirm expired pending action %; expired at %', OLD.pending_id, OLD.expires_at;
    END IF;
    -- Refuse confirmation by a user other than the proposer
    IF NEW.confirmed_by_user_id IS NULL THEN
      RAISE EXCEPTION 'Confirmation requires confirmed_by_user_id';
    END IF;
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- Verify
--   -- A plan-step (plan_id set) may move proposed → confirmed with a NULL
--   -- confirmed_by_user_id without raising; a single action (plan_id NULL)
--   -- still requires it.
--   SELECT pg_get_functiondef('shared.fn_ai_pending_action_confirm_check'::regproc);
-- ============================================================
