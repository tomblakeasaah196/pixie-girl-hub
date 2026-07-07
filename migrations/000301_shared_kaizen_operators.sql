-- ============================================================================
-- Kaizen — Phase 0: operator identity store.
--
-- Kaizen is the JBS Praxis maintenance/ops console (kaizen.pixiegirlglobal.com).
-- Its operators are SEPARATE from shared.users on purpose: a client platform
-- user (even the client CEO) must never be able to authenticate into Kaizen.
-- There is no internal RBAC — every active operator is a full admin — but every
-- action is audit-logged and destructive actions are guarded at the app layer.
--
-- See docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md §6.1, §7.2.
-- ============================================================================

-- Operators: JBS Praxis staff who can log into Kaizen.
CREATE TABLE shared.kaizen_operators (
  operator_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                CITEXT      NOT NULL UNIQUE,           -- case-insensitive
  display_name         TEXT        NOT NULL,
  phone                TEXT,                                  -- record-only (no SMS/WhatsApp in v1)
  password_hash        TEXT,                                  -- argon2; NULL until an invite is accepted
  status               TEXT        NOT NULL DEFAULT 'invited'
                         CHECK (status IN ('invited','active','disabled')),
  must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  last_login_at        TIMESTAMPTZ,
  created_by           UUID        REFERENCES shared.kaizen_operators(operator_id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pending invites (email + one-time token). The token is stored HASHED
-- (sha256 of the raw token); the raw token only ever lives in the invite link.
CREATE TABLE shared.kaizen_operator_invites (
  invite_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        CITEXT      NOT NULL,
  token_hash   TEXT        NOT NULL,
  invited_by   UUID        NOT NULL REFERENCES shared.kaizen_operators(operator_id),
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_invites_email ON shared.kaizen_operator_invites (email);
CREATE INDEX ix_kaizen_invites_token ON shared.kaizen_operator_invites (token_hash);

-- Refresh-token sessions so tokens can be revoked. The access token is a
-- short-lived JWT; the refresh token is opaque and stored HASHED.
CREATE TABLE shared.kaizen_operator_sessions (
  session_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id        UUID        NOT NULL REFERENCES shared.kaizen_operators(operator_id) ON DELETE CASCADE,
  jti                UUID        NOT NULL,
  refresh_token_hash TEXT        NOT NULL,
  user_agent         TEXT,
  ip                 INET,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX ix_kaizen_sessions_operator ON shared.kaizen_operator_sessions (operator_id);
CREATE INDEX ix_kaizen_sessions_token ON shared.kaizen_operator_sessions (refresh_token_hash);

-- Audit: who did what in Kaizen. No RBAC, but full accountability.
CREATE TABLE shared.kaizen_audit_log (
  audit_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID        REFERENCES shared.kaizen_operators(operator_id),
  action       TEXT        NOT NULL,          -- 'auth.login','operator.invite','operator.disable', ...
  target_type  TEXT,
  target_id    TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_kaizen_audit_created ON shared.kaizen_audit_log (created_at DESC);
CREATE INDEX ix_kaizen_audit_operator ON shared.kaizen_audit_log (operator_id, created_at DESC);
