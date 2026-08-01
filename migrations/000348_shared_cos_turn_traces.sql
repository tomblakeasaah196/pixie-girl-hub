-- ============================================================
-- MIGRATION 000348 — CoS: per-turn traces (observability)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff · Phase 2 (PR2-C)
--
-- Debugging a bad CoS turn used to mean grepping Pino logs. This records one
-- compact row per turn — how many model rounds it took, which vendor(s)/model(s)
-- answered, tokens, latency, how many tool calls / reads, whether it produced a
-- plan, and the outcome — so AI Control → Health & Logs can show the last N
-- turns at a glance. Metadata only: NO message content is stored here.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.ai_cos_turn_traces (
  trace_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        REFERENCES shared.ai_conversations (conversation_id) ON DELETE CASCADE,
  message_id      UUID,       -- the assistant message (soft ref; may be pruned)
  user_id         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  business        TEXT        REFERENCES shared.business_config (business_key) ON DELETE SET NULL,
  -- 'plan' (proposed a batch plan) | 'chat' (plain reply) | 'reprompt'
  -- (promised action, queued nothing) | 'stub' (feature off / no vendor) |
  -- 'error' (the turn threw)
  outcome         TEXT        NOT NULL DEFAULT 'chat'
                  CHECK (outcome IN ('plan','chat','reprompt','stub','error')),
  rounds          SMALLINT    NOT NULL DEFAULT 0,   -- model round-trips in the turn
  tool_calls      SMALLINT    NOT NULL DEFAULT 0,   -- write steps queued
  reads           SMALLINT    NOT NULL DEFAULT 0,   -- immediate read tool calls
  vendors         TEXT[]      NOT NULL DEFAULT '{}',-- distinct vendors that answered
  models          TEXT[]      NOT NULL DEFAULT '{}',
  input_tokens    INTEGER     NOT NULL DEFAULT 0,
  output_tokens   INTEGER     NOT NULL DEFAULT 0,
  total_tokens    INTEGER     NOT NULL DEFAULT 0,
  latency_ms      INTEGER     NOT NULL DEFAULT 0,
  plan_id         UUID,       -- soft ref to the produced plan, when outcome='plan'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_cos_turn_traces_recent
  ON shared.ai_cos_turn_traces (business, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cos_turn_traces_user
  ON shared.ai_cos_turn_traces (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cos_turn_traces_conversation
  ON shared.ai_cos_turn_traces (conversation_id, created_at DESC);

-- ============================================================
-- Verify
--   SELECT to_regclass('shared.ai_cos_turn_traces');   -- not null
-- ============================================================
