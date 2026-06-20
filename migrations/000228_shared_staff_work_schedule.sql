-- ============================================================
-- MIGRATION 000228 — staff work schedule (days + hours) on the
-- employee profile (Decision: "full staff onboarding wizard")
--
-- The onboarding wizard sets where/when a new hire works on day one
-- (on-site / remote / off per weekday, plus an expected start time and
-- a lateness grace window). Attendance (shared.staff_clock_events) only
-- expects a clock-in on working days, and office days are geofence-checked.
--
-- The schedule lives on the employee profile so it stays editable from the
-- HR employees table (PATCH /hr/employees/:id) after onboarding.
--
-- shared.staff_profiles is a single cross-brand table. All three columns
-- are additive and idempotent (ADD COLUMN IF NOT EXISTS), so re-running
-- this migration — or the schema-repair pass — is a no-op.
-- ============================================================

ALTER TABLE shared.staff_profiles
  -- Per-weekday mode map, e.g.
  --   {"mon":"on_site","tue":"remote","sat":"off", ...}
  -- Values: 'on_site' | 'remote' | 'off'. Empty {} = unset (treated as off).
  ADD COLUMN IF NOT EXISTS work_schedule           JSONB   NOT NULL DEFAULT '{}'::jsonb,
  -- Expected clock-in time on working days, 'HH:MM' (local). NULL = no expectation.
  ADD COLUMN IF NOT EXISTS work_expected_start_time TEXT,
  -- Minutes of grace before a clock-in counts as late.
  ADD COLUMN IF NOT EXISTS work_grace_minutes      INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN shared.staff_profiles.work_schedule IS
  'Per-weekday work mode map {mon..sun: on_site|remote|off}. Set at onboarding, editable in HR.';
COMMENT ON COLUMN shared.staff_profiles.work_expected_start_time IS
  'Expected clock-in time HH:MM on working days; NULL = no expectation.';
COMMENT ON COLUMN shared.staff_profiles.work_grace_minutes IS
  'Grace minutes before a clock-in is counted late.';
