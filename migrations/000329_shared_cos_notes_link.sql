-- ============================================================
-- MIGRATION 000329 — Chief of Staff: Save conversation to Notes
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- Links a workspace note to the CoS conversation that produced it, so
-- "Save to notes" upserts rather than duplicating: re-summarising the
-- same conversation updates its existing note in place. The partial
-- unique index is what enforces the one-note-per-conversation rule at
-- the DB level (source='cos' only, live rows only).
-- ============================================================

ALTER TABLE shared.workspace_notes
  ADD COLUMN IF NOT EXISTS source_conversation_id UUID
    REFERENCES shared.ai_conversations (conversation_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_notes_cos_conversation
  ON shared.workspace_notes (user_id, source_conversation_id)
  WHERE source = 'cos'
    AND is_deleted = false
    AND source_conversation_id IS NOT NULL;

-- Reverse lookup — "does this conversation already have a saved note?"
CREATE INDEX IF NOT EXISTS idx_workspace_notes_source_conversation
  ON shared.workspace_notes (source_conversation_id)
  WHERE source_conversation_id IS NOT NULL AND is_deleted = false;

-- ============================================================
-- Verify
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='shared' AND table_name='workspace_notes'
--    AND column_name='source_conversation_id';
-- Expected: 1 row
-- ============================================================
