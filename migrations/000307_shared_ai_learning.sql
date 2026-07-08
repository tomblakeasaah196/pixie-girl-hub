-- ============================================================
-- MIGRATION 000255 — Praxis self-learning (feedback signal)
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Praxis had no way to learn from use. This adds the feedback signal table;
-- the "learning" itself (taught facts + corrections) is stored as knowledge
-- chunks in shared.ai_knowledge_chunks (source_type 'custom') and embedded
-- immediately, so a correction is retrievable on the very next turn.
--
-- Only trusted users' corrections become knowledge (enforced in the service) —
-- this table just records the up/down signal + optional comment per message,
-- one row per (message, user), upsertable.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.ai_message_feedback (
  feedback_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Soft references (no FK) so this can't break if a message/conversation is
  -- pruned; the ids point at shared.ai_messages / shared.ai_conversations.
  message_id      UUID        NOT NULL,
  conversation_id UUID,
  user_id         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  rating          TEXT        NOT NULL CHECK (rating IN ('up', 'down')),
  comment         TEXT,
  -- When a down-vote carried a correction that we turned into a knowledge
  -- chunk, we keep the link for provenance / undo.
  taught_chunk_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_message_feedback_message
  ON shared.ai_message_feedback (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_message_feedback_rating
  ON shared.ai_message_feedback (rating, created_at DESC);
