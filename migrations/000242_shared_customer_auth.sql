-- ============================================================
-- 000242_shared_customer_auth
-- Pixie Girl Hub · JBS Praxis
--
-- Storefront-customer authentication (V2.2 §6.4 / Storefront Website). The
-- customer principal is a shared.contacts row — the password hash and the
-- email-verified flag already live there (000003: storefront_password_hash,
-- storefront_email_verified). This migration only adds the two supporting
-- tables the auth flow needs:
--
--   customer_sessions     — refresh-token rotation (httpOnly cookie). The cookie
--                           carries an opaque token; we store only its sha256.
--   customer_email_tokens — single-use email-verify + password-reset tokens.
--
-- Customers are NOT shared.users (staff). Access tokens are short-lived JWTs
-- held in memory by the website; refresh tokens rotate via these sessions.
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
-- ============================================================

-- Refresh-token sessions (one row per active device/login).
CREATE TABLE IF NOT EXISTS shared.customer_sessions (
  session_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  refresh_token_hash  TEXT        NOT NULL,           -- sha256 of the cookie value (never the raw token)
  user_agent          TEXT,
  ip                  INET,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,                     -- set on logout / rotation / forced revoke
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Refresh lookup is by token hash; keep it unique so a presented token maps to
-- exactly one (live) session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_sessions_token
  ON shared.customer_sessions (refresh_token_hash);
-- "List / revoke my active sessions" and rotation both scan a contact's live rows.
CREATE INDEX IF NOT EXISTS idx_customer_sessions_contact
  ON shared.customer_sessions (contact_id) WHERE revoked_at IS NULL;

-- Single-use email tokens for verify-email and password-reset.
CREATE TABLE IF NOT EXISTS shared.customer_email_tokens (
  token_hash   TEXT        PRIMARY KEY,                -- sha256 of the emailed token
  contact_id   UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  purpose      TEXT        NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,                            -- set when redeemed (single use)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_email_tokens_contact
  ON shared.customer_email_tokens (contact_id) WHERE consumed_at IS NULL;
