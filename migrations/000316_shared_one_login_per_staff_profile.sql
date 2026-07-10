-- ============================================================
-- 000316_shared_one_login_per_staff_profile
--
-- One login account per staff profile.
--
-- shared.users.staff_profile_id is a plain FK (000003) with no uniqueness,
-- so nothing stopped provisioning a SECOND login for the same staff member
-- under a different email. Duplicate accounts split role grants across
-- logins: org-position grants (org.service.applyPositionAssignment →
-- userIdForProfile, which picks ONE linked user) land on one account while
-- the person signs in with the other — "I granted the role but they still
-- see nothing".
--
-- A retroactive UNIQUE index could fail to apply on databases that already
-- carry duplicates, so this migration installs a BEFORE trigger instead:
-- it blocks NEW duplicate links (insert, re-link, or re-enable) while
-- leaving pre-existing duplicate rows updatable — those are surfaced by
-- `npm run audit:users` for manual merge/cleanup.
--
-- Fully idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS,
-- CREATE INDEX IF NOT EXISTS.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_staff_profile
  ON shared.users (staff_profile_id)
  WHERE staff_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION shared.fn_users_one_login_per_profile()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Only police rows that would hold an active link after this write.
  IF NEW.staff_profile_id IS NULL OR NEW.status = 'disabled' THEN
    RETURN NEW;
  END IF;

  -- Fire only when the link is being introduced: a fresh insert, a re-link
  -- to a different profile, or a disabled account coming back to life.
  -- Plain updates to an already-duplicated row must keep working so
  -- existing data stays serviceable until it is merged.
  IF TG_OP = 'UPDATE'
     AND NEW.staff_profile_id IS NOT DISTINCT FROM OLD.staff_profile_id
     AND OLD.status <> 'disabled' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM shared.users u
     WHERE u.staff_profile_id = NEW.staff_profile_id
       AND u.status <> 'disabled'
       AND u.user_id <> NEW.user_id
  ) THEN
    RAISE EXCEPTION 'staff profile % already has an active login account',
      NEW.staff_profile_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_users_one_login_per_profile ON shared.users;
CREATE TRIGGER trg_users_one_login_per_profile
  BEFORE INSERT OR UPDATE ON shared.users
  FOR EACH ROW EXECUTE FUNCTION shared.fn_users_one_login_per_profile();
