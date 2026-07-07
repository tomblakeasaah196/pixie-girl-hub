-- ============================================================
-- MIGRATION 000289 — WhatsApp / IG per-brand secret vault
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Extends shared.messaging_accounts so every secret needed to run
-- a brand's WhatsApp (and later Instagram / Facebook) integration
-- lives per-brand and encrypted at rest — no more .env dependency.
--
-- New columns:
--   business_account_id_enc — Meta WhatsApp Business Account id
--   app_secret_enc          — Meta App Secret used for HMAC on inbound
--                             webhook payloads (x-hub-signature-256)
--   verify_token_enc        — Meta GET-handshake verify token (moved
--                             from the plaintext webhook_verify_token
--                             column; old column kept for now to avoid
--                             breaking anything mid-deploy)
--   access_token_first4     — First 4 characters of the access token,
--                             stored plaintext so the UI can render
--                             a "EAAB••••" pill without a decrypt.
--   app_secret_first4       — Same for the app secret.
--   verify_token_first4     — Same for the verify token.
--   business_account_first4 — Same for the business account id.
--   secrets_last_rotated_at — When any secret was last set/updated.
--   notes                   — CEO-editable free text (e.g. link to
--                             internal doc, phone-number ownership,
--                             template approval status).
--
-- The old `webhook_verify_token` column stays — it's plaintext by
-- design (a random challenge string, not a secret) and existing rows
-- can migrate lazily. New writes go into verify_token_enc.
--
-- Also seeds messaging_accounts permission grants to any admin role
-- that already has smartcomm.edit — the CEO already had them from
-- 000219; this makes sure non-CEO managers who reply on WhatsApp
-- don't lose visibility of the config button in the messaging portal.
-- (Non-destructive: ON CONFLICT DO NOTHING.)
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. Extend messaging_accounts                                      ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.messaging_accounts
  ADD COLUMN IF NOT EXISTS business_account_id_enc  TEXT,
  ADD COLUMN IF NOT EXISTS app_secret_enc           TEXT,
  ADD COLUMN IF NOT EXISTS verify_token_enc         TEXT,
  ADD COLUMN IF NOT EXISTS access_token_first4      TEXT,
  ADD COLUMN IF NOT EXISTS app_secret_first4        TEXT,
  ADD COLUMN IF NOT EXISTS verify_token_first4      TEXT,
  ADD COLUMN IF NOT EXISTS business_account_first4  TEXT,
  ADD COLUMN IF NOT EXISTS secrets_last_rotated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes                    TEXT;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. Audit trail: track who revealed which secret and when          ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Every password-verified reveal writes a row. This gives us a
-- forensic trail if a token ever leaks and lets the CEO see who
-- last opened the vault.

CREATE TABLE IF NOT EXISTS shared.messaging_account_secret_reveals (
  reveal_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID        NOT NULL REFERENCES shared.messaging_accounts (account_id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  field         TEXT        NOT NULL
                CHECK (field IN ('access_token','app_secret','verify_token','business_account_id')),
  revealed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip     TEXT,
  request_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_messaging_account_secret_reveals_account
  ON shared.messaging_account_secret_reveals (account_id, revealed_at DESC);
CREATE INDEX IF NOT EXISTS idx_messaging_account_secret_reveals_user
  ON shared.messaging_account_secret_reveals (user_id, revealed_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. Backfill first4 on existing rows                               ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- We can't decrypt ciphertext in SQL — the first4 is populated by the
-- app on next write. This is intentional: a fresh install has no rows,
-- and existing rows will get their first4 stamped the first time an
-- operator rotates or touches the row through the new modal.

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 4. Non-CEO admin roles get messaging_accounts view                ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- CEO already has full grants (000219). Any role that has
-- smartcomm.edit is treated as an inbox manager — give them view on
-- messaging_accounts so the gear icon renders. Edit/create/delete
-- stay CEO-only unless explicitly granted.

INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT DISTINCT p.role_id, 'messaging_accounts', 'view', 'all'
FROM shared.permissions p
WHERE p.module = 'smartcomm' AND p.action = 'edit'
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'shared'
--      AND table_name   = 'messaging_accounts'
--      AND column_name IN ('app_secret_enc','verify_token_enc',
--                          'business_account_id_enc','access_token_first4');
--   SELECT COUNT(*) FROM shared.messaging_account_secret_reveals;
-- ============================================================
