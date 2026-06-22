-- ============================================================
-- MIGRATION 000234 — HR attendance: geofenced clock-in + offsite flow
-- Pixie Girl Hub · JBS Praxis · V2.2 HR build (attendance focus)
--
-- Builds on 000233. Captures WHERE a staff member clocked in (exact
-- coordinates + reverse-geocoded address + IP), compares the point to the
-- brand's office geofences, and drives the meeting's "out-of-office on a
-- working day" rule (chat brainstorm): an off-site clock-in on an on-site
-- working day is recorded but flagged, auto-raises an `offsite_clockin`
-- query, and — if the employee never answers before the deadline (or HR
-- upholds it) — the day's presence is discarded (marked absent).
--
-- Design choices from the brainstorm:
--  - Clock-in is RECORDED even when off-site (we keep the coordinates as
--    evidence) and FLAGGED, rather than hard-rejected.
--  - Geofence enforcement applies only on `on_site` days; remote/off days
--    never require location (avoids punishing legitimate remote work).
--  - Coordinates are the server-side truth; the address is display only
--    (reverse-geocoded on the client, where Google Maps is already loaded).
--  - Generous defaults: 100 m radius is set per-office; poor GPS accuracy
--    is flagged, not auto-rejected. Human review (the query) is the control.
--
-- All objects are additive + idempotent.
-- ============================================================

-- ── staff_clock_events: where + address ──────────────────
ALTER TABLE shared.staff_clock_events
  -- True when the point fell outside every active office geofence on a day
  -- geofencing was enforced. Recorded clock-in, flagged for review.
  ADD COLUMN IF NOT EXISTS is_offsite       BOOLEAN NOT NULL DEFAULT false,
  -- Human-readable address reverse-geocoded from the coordinates (display).
  ADD COLUMN IF NOT EXISTS formatted_address TEXT;

COMMENT ON COLUMN shared.staff_clock_events.is_offsite IS
  'Clocked in outside every active office geofence (recorded + flagged).';
COMMENT ON COLUMN shared.staff_clock_events.formatted_address IS
  'Reverse-geocoded address of the clock-in point (display; coords are truth).';

-- ── attendance_days: offsite reconciliation ──────────────
ALTER TABLE shared.attendance_days
  ADD COLUMN IF NOT EXISTS is_offsite        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offsite_distance_m NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS clock_in_address  TEXT,
  ADD COLUMN IF NOT EXISTS clock_in_lat      NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS clock_in_lng      NUMERIC(10,7);

COMMENT ON COLUMN shared.attendance_days.is_offsite IS
  'Reconciled day where the on-site clock-in was outside the office geofence.';

CREATE INDEX IF NOT EXISTS idx_attendance_days_offsite
  ON shared.attendance_days (business, work_date)
  WHERE is_offsite = true;

-- ── hr_settings: geofence policy ─────────────────────────
ALTER TABLE shared.hr_settings
  -- Master switch for geofence enforcement.
  ADD COLUMN IF NOT EXISTS geofence_enabled         BOOLEAN NOT NULL DEFAULT true,
  -- Require a location fix to clock in on on-site days (block if denied).
  ADD COLUMN IF NOT EXISTS geofence_required_on_site BOOLEAN NOT NULL DEFAULT true,
  -- GPS accuracy worse than this (metres) is flagged, not used to hard-reject.
  ADD COLUMN IF NOT EXISTS geofence_accuracy_max_m  INTEGER NOT NULL DEFAULT 100,
  -- Every off-site on-site-day clock-in auto-raises an offsite query.
  ADD COLUMN IF NOT EXISTS offsite_auto_query       BOOLEAN NOT NULL DEFAULT true,
  -- If the offsite query is upheld / lapses, discard presence (mark absent).
  ADD COLUMN IF NOT EXISTS offsite_marks_absent     BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN shared.hr_settings.geofence_required_on_site IS
  'Block clock-in without a location fix on on-site working days.';
COMMENT ON COLUMN shared.hr_settings.offsite_marks_absent IS
  'When an offsite query is upheld or lapses, mark that day absent (discard pay).';
