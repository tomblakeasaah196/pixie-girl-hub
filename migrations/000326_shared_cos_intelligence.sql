-- ============================================================
-- MIGRATION 000326 — Chief of Staff: intelligence (PR5)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- The "wow" cognition layer on top of the CoS agent (PR3) and the
-- accountability loop (PR4):
--
--   1. goal_templates          — reusable playbooks (§1.8, NEW table)
--   2. goals.template_id FK     — wire the PR1 placeholder column to (1)
--   3. ai_knowledge_chunks CHECK — admit the CoS RAG source_types so goal /
--                                 milestone / note / decision memory can be
--                                 embedded into the SHARED corpus (§1.8)
--
-- RAG memory REUSES shared.ai_embeddings + shared.ai_knowledge_chunks (no new
-- embedding table). CoS chunks are tagged sensitivity='restricted' + a user_id
-- in metadata, so Praxis's own retrieval (which floors at 'normal') never
-- surfaces the CEO's private planning notes, and CoS retrieval scopes to the
-- owning user + business.
--
-- Cross-brand command (wow #6) and smart scheduling (wow #5) need NO schema —
-- they are read-side filters over the already business-tagged shared.goals /
-- shared.calendar_events. So this migration adds exactly one table.
--
-- Backward compatible: goal_templates is additive; the goals FK only constrains
-- a column that was already nullable; the CHECK is widened (never narrowed), so
-- every existing ai_knowledge_chunks row still satisfies it.
--
-- See docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md §1.8 and PR5.
-- ============================================================

-- ── 1. goal_templates (playbooks) ───────────────────────────
CREATE TABLE IF NOT EXISTS shared.goal_templates (
  template_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL business = global playbook, reusable across the CEO's brands.
  business       TEXT        REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  description    TEXT,
  -- {milestones:[{title, offset_days, tasks:[{title, offset_days}]}]}
  -- offset_days are relative to the instantiation start date, so a saved
  -- playbook re-dates cleanly whenever it is reused.
  structure      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_goal_id UUID        REFERENCES shared.goals (goal_id) ON DELETE SET NULL,
  usage_count    INTEGER     NOT NULL DEFAULT 0,
  created_by     UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_goal_templates_updated_at
  BEFORE UPDATE ON shared.goal_templates
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
-- Reuse lookup: a brand's own playbooks + globals, most-used first.
CREATE INDEX IF NOT EXISTS idx_goal_templates_business
  ON shared.goal_templates (business, usage_count DESC);

-- ── 2. Wire goals.template_id → goal_templates ──────────────
-- The column shipped nullable in PR1 (000320) with the FK deliberately deferred
-- to here. A goal built from a playbook records its template; deleting the
-- template just nulls the link (SET NULL), never the goal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goals_template_id_fkey'
  ) THEN
    ALTER TABLE shared.goals
      ADD CONSTRAINT goals_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES shared.goal_templates (template_id)
      ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_goals_template
  ON shared.goals (template_id) WHERE template_id IS NOT NULL;

-- ── 3. Admit CoS RAG source types on ai_knowledge_chunks ────
-- CoS memory rides the SHARED knowledge corpus so retrieval reuses the existing
-- pgvector search — but the source_type CHECK predates it. Widen it to admit
-- the four CoS chunk kinds. Idempotent: drop-if-exists then re-add the full set.
ALTER TABLE shared.ai_knowledge_chunks
  DROP CONSTRAINT IF EXISTS ai_knowledge_chunks_source_type_check;
ALTER TABLE shared.ai_knowledge_chunks
  ADD CONSTRAINT ai_knowledge_chunks_source_type_check
  CHECK (source_type IN (
    'product_description','sop','training_material','entity_context',
    'schema_doc','action_catalogue','action_example','custom',
    'cos_goal','cos_milestone','cos_note','cos_decision'
  ));

-- ============================================================
-- Verify
--   SELECT to_regclass('shared.goal_templates');                 -- not null
--   SELECT 1 FROM pg_constraint WHERE conname='goals_template_id_fkey'; -- 1 row
--   SELECT conname FROM pg_constraint
--    WHERE conname='ai_knowledge_chunks_source_type_check';       -- 1 row (widened)
-- EXPECTED_SHARED: 195 → 196 (goal_templates is the only new table).
-- ============================================================
