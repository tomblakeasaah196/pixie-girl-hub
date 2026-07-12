-- ============================================================
-- MIGRATION 000332 — CoS: anchor a plan to the message that proposed it
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- BUG: the Chief-of-Staff chat rendered every plan card at the BOTTOM of
-- the thread, detached from the assistant message that proposed it. In a
-- long conversation the CEO saw a pile of stale-looking cards (each
-- repeating its message as the plan summary) and approved the wrong ones.
--
-- FIX: plans carry the message_id of the assistant reply that proposed
-- them; the UI interleaves each card directly after that bubble.
-- Unanchored plans (legacy rows, template/scheduler-built plans) keep the
-- end-of-thread fallback.
-- ============================================================

ALTER TABLE shared.ai_pending_plans
  ADD COLUMN IF NOT EXISTS anchor_message_id UUID
    REFERENCES shared.ai_messages (message_id) ON DELETE SET NULL;

COMMENT ON COLUMN shared.ai_pending_plans.anchor_message_id IS
  'The assistant ai_messages row that proposed this plan; the chat UI renders the plan card directly under that bubble. NULL = render at end of thread (legacy / system-built plans).';

-- ============================================================
-- Verify
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='shared' AND table_name='ai_pending_plans'
--      AND column_name='anchor_message_id';
-- ============================================================
