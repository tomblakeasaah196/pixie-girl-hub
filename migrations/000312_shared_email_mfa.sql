-- ============================================================
-- 000312_shared_email_mfa.sql
-- Pixie Girl Hub · V2.2
--
-- Adds email-based MFA (one-time code sent to the account's own email)
-- as a second factor alongside authenticator-app TOTP.
--
-- Only a single boolean flag lives on the user row — the transient
-- 6-digit codes are held in Redis with a short TTL (single-use), never
-- persisted. Delivery is email-only by design (no SMS/WhatsApp).
--
-- Opt-in per account: accounts with email_mfa_enabled = false sign in
-- exactly as before, so enabling this is zero-risk to existing users.
-- ============================================================

ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS email_mfa_enabled BOOLEAN NOT NULL DEFAULT false;
