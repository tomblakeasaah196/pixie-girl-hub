-- ============================================================
-- MIGRATION 000350 — clock-out overtime + close-time reminders (§6.11)
--
-- 1. attendance_days gains overtime_minutes — the supplementary time worked
--    PAST the expected closing time (last_clock_out − expected_end, floored
--    at 0). Mirrors early_leave_minutes on the clock-OUT side; reconcile fills
--    it every day. Tracking only — payroll's manual 'overtime' line is
--    unchanged (no auto-pay), so this is purely additive/idempotent.
-- 2. hr_settings gains clockout_reminder_enabled — the per-brand master switch
--    for the "remember to clock out" nudges (5 min before / at / 5 min after
--    the employee's closing time). DEFAULT true: both brands asked for it.
-- 3. clockout_reminders — a thin idempotency ledger so the every-minute sweep
--    sends each of the three nudges AT MOST ONCE per employee per day, even
--    across worker restarts or a second worker instance. The UNIQUE key is the
--    claim: the sweep INSERTs before it notifies, and only the winning INSERT
--    (RETURNING a row) actually fires the notification.
--
-- All statements are ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS, so
-- re-running this migration — or the schema-repair pass — is a no-op.
-- ============================================================

-- ── 1. attendance_days.overtime_minutes ─────────────────────
ALTER TABLE shared.attendance_days
  ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN shared.attendance_days.overtime_minutes IS
  'Minutes worked past the expected closing time (last_clock_out − expected_end, floored at 0). Tracking only; not auto-paid.';

-- ── 2. hr_settings.clockout_reminder_enabled ────────────────
ALTER TABLE shared.hr_settings
  ADD COLUMN IF NOT EXISTS clockout_reminder_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN shared.hr_settings.clockout_reminder_enabled IS
  'Master switch for the clock-out reminder nudges (5 min before / at / 5 min after closing time).';

-- ── 3. clockout_reminders (idempotency ledger) ──────────────
CREATE TABLE IF NOT EXISTS shared.clockout_reminders (
  reminder_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID        NOT NULL REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  business        TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  work_date       DATE        NOT NULL,
  -- Which of the three nudges: 'before' (−5m), 'at' (0), 'after' (+5m).
  offset_tag      TEXT        NOT NULL CHECK (offset_tag IN ('before', 'at', 'after')),
  notification_id UUID,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One nudge of each kind per employee per day — the sweep's dedupe claim.
  UNIQUE (profile_id, work_date, offset_tag)
);

CREATE INDEX IF NOT EXISTS idx_clockout_reminders_day
  ON shared.clockout_reminders (business, work_date);
