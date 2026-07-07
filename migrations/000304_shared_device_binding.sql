-- ============================================================
-- MIGRATION 000304 — Device binding for attendance clock-in
-- Pixie Girl Hub · JBS Praxis · HR attendance hardening
--
-- Follow-up to the clock hardening (000303). A colleague can clock a
-- buddy in from their own phone using the buddy's password. Device
-- binding closes that: each employee enrolls their own device(s) once
-- (email-OTP verified), and every clock punch records whether it came
-- from an enrolled device. Per the product decision (2026-07-07):
--
--   * Enrollment trust: email OTP only (no SMS).
--   * Unknown device: FLAG, never block — the punch is still accepted
--     and shown live, but marked device_recognized = false and raises
--     an 'unknown_device' HR query so it surfaces red on attendance.
--   * Reset (lost/replaced phone): self-service via email OTP; every
--     change is written to device_change_log and surfaced to HR & Staff.
--   * Cap: 2 active devices per employee (one laptop + one mobile is the
--     expected shape); the CEO is uncapped. The cap is enforced in the
--     service (it knows is_ceo); the DB keeps a per-fingerprint guard.
--
-- OTP challenges are NOT stored here — they live in Redis (TTL'd, hashed
-- server-side) exactly like the existing email-change OTP flow.
--
-- All objects are additive + idempotent.
-- ============================================================

-- ── Enrolled devices ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared.staff_devices (
  device_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business            TEXT        NOT NULL
                      REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  profile_id          UUID        NOT NULL
                      REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  -- The account that enrolled it. Kept even if the profile is re-linked so
  -- the audit trail of "who bound this" survives.
  user_id             UUID        NOT NULL
                      REFERENCES shared.users (user_id) ON DELETE CASCADE,
  device_fingerprint  TEXT        NOT NULL,
  device_label        TEXT        NOT NULL,            -- "iPhone 13", "Office laptop"
  device_type         TEXT        NOT NULL DEFAULT 'mobile'
                      CHECK (device_type IN ('mobile','laptop','desktop','tablet','other')),
  enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ,
  last_ip             INET,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  removed_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE shared.staff_devices IS
  'Devices an employee has enrolled for attendance clock-in. A punch from a '
  'fingerprint not present-and-active here is flagged (device_recognized=false), '
  'never blocked. Cap of 2 active per employee (CEO uncapped) enforced in the service.';

-- One active enrollment per (employee, fingerprint). A removed device can be
-- re-enrolled later (a new row); only the active set is constrained, so the
-- history in device_change_log stays intact.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_devices_active_fingerprint
  ON shared.staff_devices (profile_id, device_fingerprint)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS ix_staff_devices_profile
  ON shared.staff_devices (profile_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS ix_staff_devices_business
  ON shared.staff_devices (business);

-- ── Device change log (the HR & Staff feed + audit) ──────────
CREATE TABLE IF NOT EXISTS shared.device_change_log (
  log_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business            TEXT        NOT NULL
                      REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  profile_id          UUID        NOT NULL
                      REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  device_id           UUID        REFERENCES shared.staff_devices (device_id) ON DELETE SET NULL,
  action              TEXT        NOT NULL
                      CHECK (action IN ('enrolled','removed','replaced','flagged_unknown')),
  device_label        TEXT,
  device_fingerprint  TEXT,
  -- Who performed it. For self-service this equals the employee's user_id;
  -- for an HR-assisted removal it is the HR user.
  actor_user_id       UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE shared.device_change_log IS
  'Append-only feed of device enroll/remove/replace + unknown-device flags. '
  'Read by the HR & Staff "Devices" view so any change notifies HR.';

CREATE INDEX IF NOT EXISTS ix_device_change_log_business_time
  ON shared.device_change_log (business, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_device_change_log_profile
  ON shared.device_change_log (profile_id, created_at DESC);

-- ── Clock event: was the punch from a known device? ──────────
-- Raw append-only event carries the verdict computed at punch time so the
-- live attendance feed can render the red flag without re-deriving it.
ALTER TABLE shared.staff_clock_events
  ADD COLUMN IF NOT EXISTS device_recognized BOOLEAN,
  ADD COLUMN IF NOT EXISTS device_id         UUID
    REFERENCES shared.staff_devices (device_id) ON DELETE SET NULL;

COMMENT ON COLUMN shared.staff_clock_events.device_recognized IS
  'true = punch fingerprint matched an active enrolled device; false = unknown '
  'device (flagged, not blocked); NULL = check not applicable (CEO / no fingerprint).';

-- ── attendance_days: surface the flag on the reconciled ledger ──
ALTER TABLE shared.attendance_days
  ADD COLUMN IF NOT EXISTS clock_in_device_recognized BOOLEAN;

COMMENT ON COLUMN shared.attendance_days.clock_in_device_recognized IS
  'Mirror of the first accepted clock-in device_recognized for the day so the '
  'attendance table can flag an unknown-device clock-in (red) after reconcile.';

-- ── hr_queries: allow the unknown-device query type ──────────
ALTER TABLE shared.hr_queries
  DROP CONSTRAINT IF EXISTS hr_queries_query_type_check;
ALTER TABLE shared.hr_queries
  ADD CONSTRAINT hr_queries_query_type_check
  CHECK (query_type IN ('lateness','absence','offsite_clockin',
                        'unknown_device','conduct','performance','other'));
