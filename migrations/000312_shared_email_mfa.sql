-- ============================================================
-- 000312_shared_email_mfa.sql
-- Pixie Girl Hub · V2.2
--
-- Adds one-time email account verification ("activate your account").
--
-- Every account must verify ownership of its email address once, by
-- entering a single-use 6-digit code sent to that address. Until then
-- the app shows a persistent activation banner after sign-in; the banner
-- clears once email_verified flips true. This is a nudge, not a login
-- gate — unverified users can still sign in, so nobody is locked out.
--
-- The transient codes live in Redis (single-use, short TTL); only the
-- resulting boolean + timestamp are persisted here.
-- ============================================================

ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS email_verified     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at  TIMESTAMPTZ;
