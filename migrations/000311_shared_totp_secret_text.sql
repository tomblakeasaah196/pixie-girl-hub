-- ============================================================
-- 000311_shared_totp_secret_text.sql
-- Pixie Girl Hub · V2.2
--
-- Fix: shared.users.totp_secret_enc was declared BYTEA, but the
-- shared encryption service (services/encryption.service.js) works
-- in base64 TEXT — exactly like every other *_enc column in the
-- schema (api_key_enc, access_token_enc, credentials_enc, …).
--
-- Storing the base64 ciphertext STRING into a BYTEA column made the
-- secret impossible to decrypt on read: pg hands a BYTEA column back
-- as a Buffer, and decrypt() runs Buffer.from(buffer, "base64"),
-- which silently ignores the "base64" encoding when the first arg is
-- already a Buffer. decrypt() therefore received the raw base64 text
-- bytes instead of [iv|tag|ciphertext]; AES-256-GCM authentication
-- failed and TOTP verify threw a 500 that the admin UI surfaced to
-- users as "Invalid code. Check your authenticator app and try again."
--
-- Convert the column to TEXT so it matches the encryption service and
-- the rest of the schema. Any value already written was the base64
-- string stored as its literal UTF-8 bytes, so convert_from() recovers
-- it losslessly — an in-progress enrolment keeps working, no re-scan
-- needed. Guarded so it is a no-op if already TEXT.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'shared'
       AND table_name   = 'users'
       AND column_name  = 'totp_secret_enc'
       AND data_type    = 'bytea'
  ) THEN
    ALTER TABLE shared.users
      ALTER COLUMN totp_secret_enc TYPE TEXT
      USING convert_from(totp_secret_enc, 'UTF8');
  END IF;
END$$;
