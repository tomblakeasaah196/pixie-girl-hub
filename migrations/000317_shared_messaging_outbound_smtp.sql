-- ============================================================
-- MIGRATION 000317 — Outbound SMTP as a Messaging Account
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Today outbound email only reads SMTP_HOST / SMTP_<BRAND>_HOST etc.
-- from the process environment (src/services/email.service.js), so a
-- brand's outbound relay can only be changed by an engineer editing
-- .env and restarting the app. There is also no UI card for it — the
-- Messaging Settings modal only manages INBOUND channel wiring
-- (WhatsApp / Instagram / Facebook / inbound email mailbox).
--
-- This migration adds a new platform, 'email_outbound', to
-- shared.messaging_accounts so a brand's outbound SMTP relay can be
-- configured and rotated from the Messaging Settings UI, encrypted
-- at rest like every other secret in this table. It also adds a
-- `smtp_password_enc` / `smtp_password_first4` pair alongside plain
-- (non-secret) columns for host/port/secure/user/from/reply-to.
--
-- 'email' (existing) stays INBOUND-only — the mailbox address a
-- customer message must arrive `to`. 'email_outbound' is a distinct
-- row (own external_account_id, e.g. the From address) so a brand can
-- have both, or configure inbound via Cloudflare Email Routing while
-- outbound goes through a different relay entirely (this is exactly
-- Faitlynhair's split in docs/EMAIL_TWO_WAY_SETUP.md).
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. Allow the new platform value                                    ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.messaging_accounts
  DROP CONSTRAINT IF EXISTS messaging_accounts_platform_check;

ALTER TABLE shared.messaging_accounts
  ADD CONSTRAINT messaging_accounts_platform_check
  CHECK (platform IN ('whatsapp','instagram','facebook','email','email_outbound'));

ALTER TABLE shared.smartcomm_platform_permissions
  DROP CONSTRAINT IF EXISTS smartcomm_platform_permissions_platform_check;

ALTER TABLE shared.smartcomm_platform_permissions
  ADD CONSTRAINT smartcomm_platform_permissions_platform_check
  CHECK (platform IN ('whatsapp','instagram','facebook','email','email_outbound','internal'));

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. SMTP columns                                                    ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- host/port/secure/user/from/reply_to are not secrets — plain columns.
-- Only the SMTP password is encrypted, mirroring access_token_enc.

ALTER TABLE shared.messaging_accounts
  ADD COLUMN IF NOT EXISTS smtp_host             TEXT,
  ADD COLUMN IF NOT EXISTS smtp_port             SMALLINT,
  ADD COLUMN IF NOT EXISTS smtp_secure           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS smtp_user             TEXT,
  ADD COLUMN IF NOT EXISTS smtp_password_enc     TEXT,
  ADD COLUMN IF NOT EXISTS smtp_password_first4  TEXT,
  ADD COLUMN IF NOT EXISTS from_email            TEXT,
  ADD COLUMN IF NOT EXISTS from_name             TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_email        TEXT;

-- Track the SMTP password in the reveal-field audit CHECK too.
ALTER TABLE shared.messaging_account_secret_reveals
  DROP CONSTRAINT IF EXISTS messaging_account_secret_reveals_field_check;

ALTER TABLE shared.messaging_account_secret_reveals
  ADD CONSTRAINT messaging_account_secret_reveals_field_check
  CHECK (field IN ('access_token','app_secret','verify_token',
                    'business_account_id','smtp_password'));

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. messaging_accounts.edit grant already covers this platform     ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- No new permission needed — 'email_outbound' rows are managed through
-- the same messaging_accounts RBAC module as every other platform.

-- ============================================================
-- Verify
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'shared' AND table_name = 'messaging_accounts'
--      AND column_name LIKE 'smtp_%' OR column_name LIKE 'from_%'
--       OR column_name = 'reply_to_email';
-- ============================================================
