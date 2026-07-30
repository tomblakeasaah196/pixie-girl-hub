-- ============================================================================
-- Kaizen — self-service password reset (OTP over email).
--
-- Kaizen has no platform-side recovery path: operators live in
-- shared.kaizen_operators, separate from shared.users, so a forgotten password
-- previously needed SSH + a manual argon2 hash. This table backs the OTP flow
-- (request code → verify code → set new password).
--
-- The code is stored HASHED (sha256 of the 6 digits), same convention as
-- kaizen_operator_invites.token_hash — the raw code only ever lives in the
-- email. Tokens are tied to operator_id, not email, so an operator email change
-- never orphans a live code.
--
-- See docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md §6.1.
-- ============================================================================

CREATE TABLE IF NOT EXISTS shared.kaizen_password_reset_tokens (
  token_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID        NOT NULL REFERENCES shared.kaizen_operators(operator_id) ON DELETE CASCADE,
  code_hash     TEXT        NOT NULL,          -- sha256 of the 6-digit code
  attempt_count SMALLINT    NOT NULL DEFAULT 0,
  max_attempts  SMALLINT    NOT NULL DEFAULT 3,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,                   -- NULL = still redeemable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial predicates stay IMMUTABLE (no now() — Postgres rejects a STABLE
-- function in an index predicate). Expiry is filtered at query time instead.
CREATE INDEX IF NOT EXISTS ix_kaizen_pwreset_operator
  ON shared.kaizen_password_reset_tokens (operator_id, created_at DESC)
  WHERE used_at IS NULL;
