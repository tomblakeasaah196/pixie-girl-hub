-- Per-weekday start/end overrides for employee work schedules.
-- Missing day entries inherit work_expected_start_time/work_expected_end_time.
ALTER TABLE shared.staff_profiles
  ADD COLUMN IF NOT EXISTS work_schedule_times JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN shared.staff_profiles.work_schedule_times IS
  'Optional per-weekday hours {mon:{start:"09:00",end:"17:00"},...}; missing days inherit employee default hours.';
