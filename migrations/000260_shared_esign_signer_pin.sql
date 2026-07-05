-- ============================================================
-- MIGRATION 000260 — Signer page: PIN-protected signature-on-file
-- Pixie Girl Hub · JBS Praxis · HR system audit follow-up
--
-- Backs the public signer page (/sign/:token). The e-signature backend
-- (000101) already stores a per-signing captured signature + tamper-evident
-- audit chain. This migration adds the two things the signer page needs:
--
--  1. shared.signer_signatures — a reusable "signature on file", protected
--     by a PIN and keyed by the signer's email. The model the product owner
--     asked for: anyone can sign, but to STORE a signature (so you don't
--     re-draw it on every future document) you set a PIN. Next time you only
--     enter the PIN and your saved signature is applied. Works for staff,
--     contacts, and pure-external signers alike (email is the common key).
--
--  2. signature_request_signers.signature_data_url + verification_code —
--     the drawn signature is captured inline as a base64 PNG data URL, and
--     each signature gets a short, human-readable verification code (derived
--     from the audit hash) that is printed on the document and looked up on
--     the public verify page ("timestamp + hash verification number so it can
--     be verified").
--
-- Table delta: +1 shared table (signer_signatures).
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ SIGNER_SIGNATURES — reusable signature on file, unlocked by a PIN   ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.signer_signatures (
  signer_signature_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable identity key. Every signer row carries an email snapshot; this is
  -- what links a saved signature to the person across many documents.
  signer_email          CITEXT      NOT NULL UNIQUE,
  -- When the signer is a known platform user, link it (nullable — external
  -- signers have no user row). Not the identity key; convenience for joins.
  user_id               UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  -- The drawn signature, stored inline as a base64 PNG data URL. Signatures
  -- are small (a few KB up to ~tens of KB); inline storage keeps the signer
  -- page self-contained and avoids a media round-trip on every sign.
  signature_data_url    TEXT        NOT NULL,
  -- Argon2 hash of the signing PIN. Never store the PIN itself.
  pin_hash              TEXT        NOT NULL,
  pin_set_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Brute-force guard: strikes lock the saved signature for a cool-off window.
  pin_failed_count      SMALLINT    NOT NULL DEFAULT 0,
  pin_locked_until      TIMESTAMPTZ,
  last_used_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_signer_signatures_updated_at
  BEFORE UPDATE ON shared.signer_signatures
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_signer_signatures_user
  ON shared.signer_signatures (user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE shared.signer_signatures IS
  'Reusable signature-on-file, PIN-protected, keyed by signer email. Set a PIN once to save your drawn signature; later documents only need the PIN.';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ signature_request_signers: inline drawn signature + verification code║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.signature_request_signers
  ADD COLUMN signature_data_url TEXT,   -- base64 PNG captured/applied at signing
  ADD COLUMN verification_code  TEXT;   -- short human-verifiable code (shown on doc + verify page)

COMMENT ON COLUMN shared.signature_request_signers.signature_data_url IS
  'The drawn signature as a base64 PNG data URL, captured at sign time (or applied from the signer''s saved signature-on-file).';
COMMENT ON COLUMN shared.signature_request_signers.verification_code IS
  'Short human-readable code derived from audit_hash; printed on the signed document and resolvable on the public verify page.';

-- The original signed-consistency CHECK (000101) required a
-- captured_signature_path (a media path). The signer page captures the
-- signature inline as a data URL instead, so accept EITHER form as proof
-- that a signed row carries a signature artifact.
ALTER TABLE shared.signature_request_signers
  DROP CONSTRAINT IF EXISTS signer_signed_consistency;
ALTER TABLE shared.signature_request_signers
  ADD CONSTRAINT signer_signed_consistency CHECK (
    status <> 'signed' OR (
      signed_at IS NOT NULL
      AND (captured_signature_path IS NOT NULL OR signature_data_url IS NOT NULL)
      AND audit_hash IS NOT NULL
    )
  );

CREATE INDEX idx_signature_signers_verification_code
  ON shared.signature_request_signers (verification_code)
  WHERE verification_code IS NOT NULL;

-- ============================================================
-- After this migration: shared schema gains 1 new table
--   • signer_signatures
-- Plus signature_request_signers.signature_data_url + verification_code
-- and a relaxed signer_signed_consistency CHECK.
-- ============================================================
