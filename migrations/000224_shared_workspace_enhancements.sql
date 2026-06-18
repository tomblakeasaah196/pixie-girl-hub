-- ============================================================
-- MIGRATION 000224 — Workspace enhancements (Tasks + Calendar)
--
-- 1. Migrate task statuses from time-based to status-based
-- 2. Add missing task columns (is_personal, reminder, calendar link)
-- 3. Add is_private to calendar_events
-- 4. Create task_watchers table
-- 5. Add display_name JOINs via indexes
-- ============================================================

-- ── 1. Migrate task statuses ────────────────────────────────
-- Map old time-based statuses → new status-based ones
UPDATE shared.tasks SET status = 'to_do'       WHERE status IN ('inbox', 'today', 'later');
UPDATE shared.tasks SET status = 'in_progress' WHERE status IN ('this_week', 'this_month');
-- 'done' and 'cancelled' stay as-is

-- Drop old CHECK and add new one
ALTER TABLE shared.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE shared.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('to_do', 'in_progress', 'in_review', 'done', 'cancelled'));

-- ── 2. Add missing task columns ─────────────────────────────
ALTER TABLE shared.tasks ADD COLUMN IF NOT EXISTS is_personal      BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE shared.tasks ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER;
ALTER TABLE shared.tasks ADD COLUMN IF NOT EXISTS remind_at        TIMESTAMPTZ;
ALTER TABLE shared.tasks ADD COLUMN IF NOT EXISTS calendar_event_id UUID REFERENCES shared.calendar_events(event_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_remind_at
  ON shared.tasks (remind_at)
  WHERE remind_at IS NOT NULL AND is_deleted = false AND status <> 'done';

CREATE INDEX IF NOT EXISTS idx_tasks_calendar_event
  ON shared.tasks (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

-- ── 3. Add is_private to calendar_events ────────────────────
ALTER TABLE shared.calendar_events ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- ── 4. Create task_watchers ─────────────────────────────────
CREATE TABLE IF NOT EXISTS shared.task_watchers (
  task_id    UUID        NOT NULL REFERENCES shared.tasks(task_id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES shared.users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

-- ============================================================
-- Verify
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'shared' AND table_name = 'tasks'
-- AND column_name IN ('is_personal','reminder_minutes','remind_at','calendar_event_id');
-- Expected: 4 rows
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'shared' AND table_name = 'task_watchers';
-- Expected: 1 row
-- ============================================================
