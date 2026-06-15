-- ============================================================
-- MIGRATION 000211 — IAM & Security module
-- Pixie Girl Hub · V2.2
--
-- Adds: TOTP columns on users, session tracking table,
--       access review attestation tables, standalone users
--       (no HR profile), iam permission key.
-- ============================================================

-- ── TOTP / MFA columns on shared.users ──────────────────────
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS totp_secret_enc   BYTEA,
  ADD COLUMN IF NOT EXISTS totp_enabled      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_verified_at  TIMESTAMPTZ;

-- ── Session metadata (complements Redis refresh tokens) ─────
-- One row per active refresh-token. Inserted on login/refresh,
-- deleted on logout/revoke. Redis remains the auth gate; this
-- table provides the admin-visible session list with device info.
CREATE TABLE IF NOT EXISTS shared.user_sessions (
  session_id    TEXT        PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES shared.users(user_id),
  ip_address    INET,
  user_agent    TEXT,
  device_label  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON shared.user_sessions (user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
  ON shared.user_sessions (expires_at);

-- ── Standalone users (external auditor / contractor) ────────
-- These have a login (shared.users row) but no HR staff profile.
-- The profile_type distinguishes them from staff-linked users.
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS profile_type TEXT NOT NULL DEFAULT 'staff'
    CHECK (profile_type IN ('staff', 'external'));
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS external_label TEXT;

-- ── Access review attestation ───────────────────────────────
CREATE TABLE IF NOT EXISTS shared.access_reviews (
  review_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  description   TEXT,
  status        TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  initiated_by  UUID        NOT NULL,
  initiated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  completed_by  UUID,
  summary_note  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared.access_review_entries (
  entry_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     UUID        NOT NULL REFERENCES shared.access_reviews(review_id)
                            ON DELETE CASCADE,
  user_id       UUID        NOT NULL,
  user_name     TEXT        NOT NULL,
  user_email    CITEXT,
  role_name     TEXT,
  businesses    TEXT[]      NOT NULL DEFAULT '{}',
  permissions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision      TEXT        NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'approved', 'revoked', 'flagged')),
  reviewer_note TEXT,
  decided_by    UUID,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_review_entries_review
  ON shared.access_review_entries (review_id);

-- ── IAM permission key ──────────────────────────────────────
-- Seed the iam module into the RBAC catalog so it's enforceable.
-- The owner/CEO bypasses all checks; delegated admins need this.
INSERT INTO shared.permissions (role_id, module, action)
SELECT r.role_id, 'iam', a.action
FROM shared.roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('export')) AS a(action)
WHERE r.role_name = 'owner'
ON CONFLICT DO NOTHING;

-- ── Cleanup: expire stale sessions ──────────────────────────
-- A simple function the cron / pg_cron can call.
CREATE OR REPLACE FUNCTION shared.cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE removed INT;
BEGIN
  DELETE FROM shared.user_sessions WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
