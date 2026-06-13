-- ============================================================
-- 000114_shared_staff_invitations
-- F-15 — Staff invite / onboarding flow.
--
-- An admin creates an invitation (email + roles + brand access). A single-use
-- raw token is generated, emailed to the invitee, and stored only as a SHA-256
-- hash (never in plaintext). The invitee accepts by setting a password, which
-- creates their shared.users login, grants the roles/brands, and marks the
-- invitation accepted. Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.staff_invitations (
  invitation_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT      NOT NULL,
  display_name      TEXT,
  -- SHA-256 of the raw token; the raw token is emailed and never stored.
  token_hash        TEXT        NOT NULL UNIQUE,
  -- What the invitee gets on accept
  role_ids          UUID[]      NOT NULL DEFAULT '{}',
  business_keys     TEXT[]      NOT NULL DEFAULT '{}',
  default_business  TEXT,
  is_ceo            BOOLEAN     NOT NULL DEFAULT false,
  -- Optional link to a pre-created HR profile
  staff_profile_id  UUID        REFERENCES shared.staff_profiles (profile_id) ON DELETE SET NULL,
  -- Lifecycle
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  accepted_at       TIMESTAMPTZ,
  accepted_user_id  UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_staff_invitations_updated_at ON shared.staff_invitations;
CREATE TRIGGER trg_staff_invitations_updated_at
  BEFORE UPDATE ON shared.staff_invitations
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_invitations_token
  ON shared.staff_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_status
  ON shared.staff_invitations (status, expires_at);

-- At most one live (pending) invitation per email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_invitations_pending_email
  ON shared.staff_invitations (email) WHERE status = 'pending';
