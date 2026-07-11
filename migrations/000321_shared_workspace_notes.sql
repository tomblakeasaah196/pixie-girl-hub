-- ============================================================
-- MIGRATION 000321 — Chief of Staff: Workspace Notes (PR1)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- The "Notes" surface of the Workspace ("a better Notion"). Notes are
-- personal to their owner by default and can optionally link to a goal
-- or milestone. Markdown body. Business-tagged, shared schema.
--
-- See docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md §1.4 and PR1.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.workspace_notes (
  note_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  title         TEXT,
  body          TEXT        NOT NULL DEFAULT '',
  goal_id       UUID        REFERENCES shared.goals (goal_id) ON DELETE SET NULL,
  milestone_id  UUID        REFERENCES shared.goal_milestones (milestone_id) ON DELETE SET NULL,
  pinned        BOOLEAN     NOT NULL DEFAULT false,
  source        TEXT        NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual','cos','meeting')),
  is_deleted    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_workspace_notes_updated_at
  BEFORE UPDATE ON shared.workspace_notes
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_workspace_notes_owner
  ON shared.workspace_notes (business, user_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_workspace_notes_goal
  ON shared.workspace_notes (goal_id) WHERE goal_id IS NOT NULL;
-- Trigram search over the body (pg_trgm is already enabled — shared.contacts
-- uses gin_trgm_ops in 000003).
CREATE INDEX IF NOT EXISTS idx_workspace_notes_body_trgm
  ON shared.workspace_notes USING GIN (body gin_trgm_ops);

-- ============================================================
-- Verify
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='shared' AND table_name='workspace_notes';
-- Expected: 1 row
-- ============================================================
