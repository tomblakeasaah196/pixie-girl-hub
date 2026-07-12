-- ============================================================
-- MIGRATION 000334 — Inbound IMAP polling on the outbound relay
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Two-way email without Cloudflare Email Routing. Both brands host mail
-- on Hostinger, whose MX we cannot hand to Cloudflare without breaking
-- the existing mailboxes. Instead the Hub polls the SAME mailbox it
-- already sends from (the 'email_outbound' row: smtp_user +
-- smtp_password_enc) over IMAP and threads replies into the inbox.
--
-- So this migration does NOT add a new platform or a new secret — it
-- extends the existing 'email_outbound' row with the few IMAP-only
-- details (host/port/secure) plus a poll toggle and a fetch cursor.
-- Auth (user + password) and the mailbox address are reused from the
-- outbound SMTP config, since for Hostinger the send/receive account is
-- one and the same.
-- ============================================================

ALTER TABLE shared.messaging_accounts
  ADD COLUMN IF NOT EXISTS imap_host             TEXT,
  ADD COLUMN IF NOT EXISTS imap_port             SMALLINT,
  ADD COLUMN IF NOT EXISTS imap_secure           BOOLEAN NOT NULL DEFAULT true,
  -- Opt-in per connection: only mailboxes the operator explicitly ticks
  -- get polled, so enabling this feature never surprises a brand.
  ADD COLUMN IF NOT EXISTS inbound_poll_enabled  BOOLEAN NOT NULL DEFAULT false,
  -- Fetch cursor. imap_uidvalidity guards against a mailbox UID reset
  -- (IMAP servers bump UIDVALIDITY when UIDs are no longer stable — the
  -- poller must then re-baseline instead of trusting imap_last_uid).
  ADD COLUMN IF NOT EXISTS imap_last_uid         BIGINT,
  ADD COLUMN IF NOT EXISTS imap_uidvalidity      BIGINT,
  ADD COLUMN IF NOT EXISTS imap_last_polled_at   TIMESTAMPTZ;

-- ============================================================
-- Verify
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'shared' AND table_name = 'messaging_accounts'
--      AND column_name LIKE 'imap_%' OR column_name = 'inbound_poll_enabled';
-- ============================================================
