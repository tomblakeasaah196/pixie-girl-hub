-- ============================================================
-- 000113_shared_users_auth_reconcile
--
-- Reconciles a real schema/code drift in the auth foundation. Two conventions
-- coexist in the codebase against shared.users:
--
--   • access/grants/workflows/payroll read/write:
--       is_active, permitted_businesses, default_business, failed_login_attempts
--     (these exist — migration 000003).
--   • staff/auth (staff.repo, the login path) + ai-briefing read/write:
--       display_name, status, is_ceo, default_business_key, failed_login_count,
--       last_login_user_agent, and a table shared.user_business_access
--     (these were NEVER created — login would fail against the 000003 schema).
--
-- This migration ADDS the auth-expected columns + shared.user_business_access,
-- and installs triggers that keep the two conventions in sync so NEITHER module
-- breaks (status<->is_active, default_business<->default_business_key,
-- failed_login_count<->failed_login_attempts, permitted_businesses->table).
--
-- Canonical writers (observed in code):
--   status               ← staff.repo (recordFailedLogin sets 'locked')
--   is_active            ← read by access/grants/workflows/payroll
--   default_business     ← grants.repo.setUserAccess
--   default_business_key ← read by staff.repo
--   failed_login_count   ← staff.repo
--   permitted_businesses ← grants.repo.setUserAccess (table mirrors it)
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS before CREATE. The
-- one-time backfill is guarded to run only before the sync trigger exists, so
-- re-applying the migration never clobbers runtime state.
-- ============================================================

-- 1) Auth-expected columns on shared.users
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS display_name          TEXT,
  ADD COLUMN IF NOT EXISTS is_ceo                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status                TEXT    NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS default_business_key  TEXT,
  ADD COLUMN IF NOT EXISTS failed_login_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_user_agent TEXT;

-- status lifecycle CHECK (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check'
  ) THEN
    ALTER TABLE shared.users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active','invited','suspended','locked','disabled'));
  END IF;
END$$;

-- 2) shared.user_business_access — per-user brand access (mirrors
--    users.permitted_businesses; read by staff.repo as available_businesses).
CREATE TABLE IF NOT EXISTS shared.user_business_access (
  user_id      UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  business_key TEXT        NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by   UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, business_key)
);

-- 3) One-time backfill of existing rows. Guarded so it only runs on the FIRST
--    apply (before the sync trigger exists); afterwards the triggers keep the
--    columns consistent, so a re-apply must NOT recompute (it would overwrite
--    runtime state such as a 'locked' status).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_auth_sync'
  ) THEN
    UPDATE shared.users
       SET status               = CASE WHEN is_active THEN 'active' ELSE 'suspended' END,
           default_business_key = default_business,
           failed_login_count   = failed_login_attempts,
           display_name         = COALESCE(display_name, split_part(email::text, '@', 1));

    INSERT INTO shared.user_business_access (user_id, business_key)
    SELECT u.user_id, b
      FROM shared.users u, unnest(u.permitted_businesses) AS b
    ON CONFLICT DO NOTHING;
  END IF;
END$$;

-- 4) BEFORE trigger: keep the scalar alias columns in sync on every write.
CREATE OR REPLACE FUNCTION shared.fn_users_auth_sync()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- status <-> is_active. status is canonical; but if a writer toggled
  -- is_active directly (and left status untouched), derive status from it.
  IF TG_OP = 'UPDATE'
     AND NEW.is_active IS DISTINCT FROM OLD.is_active
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.status := CASE WHEN NEW.is_active THEN 'active' ELSE 'suspended' END;
  ELSE
    NEW.is_active := (NEW.status = 'active');
  END IF;

  -- default_business is the canonical writer (grants.repo); key follows it.
  NEW.default_business_key := NEW.default_business;
  -- failed_login_count is the canonical writer (staff.repo); attempts follows.
  NEW.failed_login_attempts := NEW.failed_login_count;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_users_auth_sync ON shared.users;
CREATE TRIGGER trg_users_auth_sync
  BEFORE INSERT OR UPDATE ON shared.users
  FOR EACH ROW EXECUTE FUNCTION shared.fn_users_auth_sync();

-- 5) AFTER trigger: rebuild shared.user_business_access from
--    permitted_businesses whenever it changes (or on insert).
CREATE OR REPLACE FUNCTION shared.fn_users_brand_access_sync()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.permitted_businesses IS NOT DISTINCT FROM OLD.permitted_businesses THEN
    RETURN NULL; -- brand access unchanged
  END IF;
  DELETE FROM shared.user_business_access WHERE user_id = NEW.user_id;
  INSERT INTO shared.user_business_access (user_id, business_key)
  SELECT NEW.user_id, b
    FROM unnest(COALESCE(NEW.permitted_businesses, '{}')) AS b
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END$$;

DROP TRIGGER IF EXISTS trg_users_brand_access_sync ON shared.users;
CREATE TRIGGER trg_users_brand_access_sync
  AFTER INSERT OR UPDATE ON shared.users
  FOR EACH ROW EXECUTE FUNCTION shared.fn_users_brand_access_sync();

CREATE INDEX IF NOT EXISTS idx_user_business_access_user
  ON shared.user_business_access (user_id);
CREATE INDEX IF NOT EXISTS idx_users_is_ceo
  ON shared.users (is_ceo) WHERE is_ceo = true;
