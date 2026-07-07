-- ============================================================
-- MIGRATION 000303 — Attendance clock controls: dedupe + clock-out
-- location + in/out IP surfacing
-- Pixie Girl Hub · JBS Praxis · HR attendance hardening
--
-- Follow-up to the clock-in audit (2026-07-07). Three concerns:
--
--  1. DUPLICATE CLOCK-IN. staff_clock_events is append-only with no
--     per-day uniqueness, so a double-tap / direct API call / two tabs
--     could record two `clock_in` rows for one day. The service layer now
--     enforces one accepted clock_in + one accepted clock_out per day
--     (a state machine); this migration adds the matching DB backstop for
--     the concurrent-double-tap race. `occurred_on` is the Lagos calendar
--     day of the event (both businesses operate in Africa/Lagos), populated
--     by a trigger so it is always consistent with occurred_at regardless
--     of the writer. The unique index is created defensively: on an install
--     that already carries historical duplicates it is skipped (we never
--     mutate the append-only log), and the service guard remains the control.
--
--  2. CLOCK-OUT LOCATION. Location is now mandatory for BOTH clock-in and
--     clock-out (enforced in the service). The raw event already stored the
--     clock-out coordinates/address; the reconciled day ledger did not.
--     Add clock_out_{lat,lng,address,is_offsite,distance_m} so the exact
--     clock-out place is queryable + shown in the attendance tables.
--
--  3. IN/OUT IP. The raw event already carried ip_address for every punch;
--     the day ledger did not surface it. Add clock_in_ip / clock_out_ip so
--     the attendance tables can display the network the punch came from
--     (audit evidence — NOT an identity control; office WiFi NATs everyone).
--
-- All objects are additive + idempotent.
-- ============================================================

-- ── staff_clock_events: Lagos calendar day + one-per-day guard ──
ALTER TABLE shared.staff_clock_events
  ADD COLUMN IF NOT EXISTS occurred_on DATE;

COMMENT ON COLUMN shared.staff_clock_events.occurred_on IS
  'Africa/Lagos calendar day of occurred_at (trigger-maintained). Backs the '
  'one-accepted-clock_in / one-accepted-clock_out per day uniqueness guard.';

-- Keep occurred_on in lock-step with occurred_at (Lagos day). A trigger is
-- used because AT TIME ZONE / ::date are STABLE (not IMMUTABLE) and so cannot
-- appear directly in a unique-index expression.
CREATE OR REPLACE FUNCTION shared.fn_clock_event_occurred_on()
RETURNS TRIGGER AS $$
BEGIN
  NEW.occurred_on := (NEW.occurred_at AT TIME ZONE 'Africa/Lagos')::date;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clock_event_occurred_on ON shared.staff_clock_events;
CREATE TRIGGER trg_clock_event_occurred_on
  BEFORE INSERT ON shared.staff_clock_events
  FOR EACH ROW EXECUTE FUNCTION shared.fn_clock_event_occurred_on();

-- Backfill existing rows (append-only: we only compute the derived day).
UPDATE shared.staff_clock_events
   SET occurred_on = (occurred_at AT TIME ZONE 'Africa/Lagos')::date
 WHERE occurred_on IS NULL;

-- Backstop for the concurrent-double-tap race the service guard cannot see
-- across transactions. Only ACCEPTED events are constrained (rejected attempts
-- are still recorded, the truth of what was tried). Created defensively so a
-- pre-existing duplicate in the append-only log never breaks the deploy — the
-- service guard is the primary control either way.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_clock_events_one_accepted_per_day
      ON shared.staff_clock_events (profile_id, occurred_on, event_type)
      WHERE accepted = true;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE
      'uq_clock_events_one_accepted_per_day skipped: historical duplicates '
      'present. Service-layer guard enforces one clock_in/clock_out per day '
      'going forward.';
  END;
END $$;

-- ── attendance_days: clock-out location + in/out IP ──────────
ALTER TABLE shared.attendance_days
  ADD COLUMN IF NOT EXISTS clock_out_address    TEXT,
  ADD COLUMN IF NOT EXISTS clock_out_lat        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS clock_out_lng        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS clock_out_is_offsite BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clock_out_distance_m NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS clock_in_ip          INET,
  ADD COLUMN IF NOT EXISTS clock_out_ip         INET;

COMMENT ON COLUMN shared.attendance_days.clock_out_address IS
  'Reverse-geocoded address of the last clock-out point (display; coords are truth).';
COMMENT ON COLUMN shared.attendance_days.clock_out_is_offsite IS
  'Last clock-out fell outside every active office geofence on an on-site day.';
COMMENT ON COLUMN shared.attendance_days.clock_in_ip IS
  'IP the first clock-in was recorded from (audit evidence, not identity proof).';
COMMENT ON COLUMN shared.attendance_days.clock_out_ip IS
  'IP the last clock-out was recorded from (audit evidence, not identity proof).';
