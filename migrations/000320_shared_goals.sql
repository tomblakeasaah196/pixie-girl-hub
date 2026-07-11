-- ============================================================
-- MIGRATION 000320 — Chief of Staff: Goals data model (PR1)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- Adds the goals layer that sits above the existing Workspace tasks
-- and calendar. Goals live in the SHARED schema, business-tagged
-- (identical isolation model to shared.tasks / shared.calendar_events).
--
--   1. shared.goals             — top-level objectives with cached progress
--   2. shared.goal_milestones   — ordered milestones (+ dependency chain)
--   3. shared.goal_stakeholders — link users/contacts to a goal
--   4. link columns             — tasks/calendar_events -> goal_id/milestone_id
--
-- See docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md §1 and PR1.
-- ============================================================

-- ── 1. goals ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared.goals (
  goal_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business        TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','on_hold','achieved','archived','cancelled')),
  priority        TEXT        NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  owner_user_id   UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  target_date     DATE,
  progress_pct    SMALLINT    NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  health          TEXT        NOT NULL DEFAULT 'on_track'
                  CHECK (health IN ('on_track','at_risk','behind','achieved')),
  source          TEXT        NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','cos','template')),
  -- template_id FK is wired in PR5 (shared.goal_templates); kept nullable now
  -- so the column exists from day one without a forward dependency.
  template_id     UUID,
  created_by      UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE RESTRICT,
  is_deleted      BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_goals_updated_at
  BEFORE UPDATE ON shared.goals
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_goals_business_status
  ON shared.goals (business, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_goals_owner
  ON shared.goals (owner_user_id, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_goals_target
  ON shared.goals (target_date) WHERE target_date IS NOT NULL AND is_deleted = false;

-- ── 2. goal_milestones ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared.goal_milestones (
  milestone_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id                 UUID        NOT NULL REFERENCES shared.goals (goal_id) ON DELETE CASCADE,
  title                   TEXT        NOT NULL,
  description             TEXT,
  status                  TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','in_progress','done','skipped')),
  target_date             DATE,
  display_order           SMALLINT    NOT NULL DEFAULT 0,
  depends_on_milestone_id UUID        REFERENCES shared.goal_milestones (milestone_id) ON DELETE SET NULL,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_goal_milestones_updated_at
  BEFORE UPDATE ON shared.goal_milestones
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_goal_milestones_goal
  ON shared.goal_milestones (goal_id, display_order);

-- ── 3. goal_stakeholders ────────────────────────────────────
-- Exactly one of user_id / contact_id per row. Surrogate PK so the API can
-- address a stakeholder row by id; uniqueness enforced by partial indexes.
CREATE TABLE IF NOT EXISTS shared.goal_stakeholders (
  stakeholder_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id         UUID        NOT NULL REFERENCES shared.goals (goal_id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES shared.users (user_id) ON DELETE CASCADE,
  contact_id      UUID        REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  role            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stakeholder_user_xor_contact CHECK (
    (user_id IS NOT NULL AND contact_id IS NULL) OR
    (user_id IS NULL AND contact_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_stakeholder_user
  ON shared.goal_stakeholders (goal_id, user_id)    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_stakeholder_contact
  ON shared.goal_stakeholders (goal_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goal_stakeholders_goal
  ON shared.goal_stakeholders (goal_id);

-- ── 4. link columns on existing Workspace tables ────────────
ALTER TABLE shared.tasks
  ADD COLUMN IF NOT EXISTS goal_id      UUID REFERENCES shared.goals (goal_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES shared.goal_milestones (milestone_id) ON DELETE SET NULL;
ALTER TABLE shared.calendar_events
  ADD COLUMN IF NOT EXISTS goal_id      UUID REFERENCES shared.goals (goal_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES shared.goal_milestones (milestone_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_goal
  ON shared.tasks (goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_goal
  ON shared.calendar_events (goal_id) WHERE goal_id IS NOT NULL;

-- ============================================================
-- Verify
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='shared'
--    AND table_name IN ('goals','goal_milestones','goal_stakeholders');
-- Expected: 3 rows
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='shared' AND table_name='tasks'
--    AND column_name IN ('goal_id','milestone_id');
-- Expected: 2 rows
-- ============================================================
