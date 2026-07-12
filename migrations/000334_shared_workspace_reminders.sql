-- ============================================================
-- MIGRATION 000334 — Workspace reminders that actually fire
-- Pixie Girl Hub · V2.2 · Tasks & Calendar
--
-- GAP: shared.tasks.remind_at (000224) was written on create and then
-- nothing ever read it — no sweep, no notification, and an edited due date
-- never re-derived it. Calendar events had no reminder support at all.
--
-- ADDITIONS:
--   - tasks.reminder_sent_at            — sweep bookkeeping (NULL = armed).
--   - calendar_events.reminder_minutes  — relative reminder (minutes before
--     start_at), mirroring tasks.
--   - calendar_events.remind_at         — the resolved reminder instant;
--     custom reminders write it directly.
--   - calendar_events.reminder_sent_at  — sweep bookkeeping.
--   - partial indexes for the due-reminder sweep on both tables.
--
-- The workspace-reminders scheduler (src/jobs/schedulers/) notifies the
-- owner when remind_at <= now() and stamps reminder_sent_at. Editing a
-- reminder clears reminder_sent_at so the moved reminder re-fires.
-- ============================================================

ALTER TABLE shared.tasks
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

ALTER TABLE shared.calendar_events
  ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS remind_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Sweep indexes: only armed, live reminders.
CREATE INDEX IF NOT EXISTS idx_tasks_reminder_due
  ON shared.tasks (remind_at)
  WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL
    AND is_deleted = false AND status NOT IN ('done','cancelled');

CREATE INDEX IF NOT EXISTS idx_calendar_events_reminder_due
  ON shared.calendar_events (remind_at)
  WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL
    AND is_deleted = false;

-- ============================================================
-- Verify
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='shared' AND table_name='calendar_events'
--      AND column_name IN ('reminder_minutes','remind_at','reminder_sent_at');
-- ============================================================
