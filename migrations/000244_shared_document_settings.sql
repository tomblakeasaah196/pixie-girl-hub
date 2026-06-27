-- ============================================================
-- 000244_shared_document_settings
-- Pixie Girl Hub · JBS Praxis
--
-- Editable copy for invoices, receipts and their accompanying mail (V2.2 §6.5).
-- Surfaced through the Invoicing → Settings tab (NOT the global Business
-- Settings), so each brand curates its own document wording — the soft note
-- card and the personal, intentional thank-you line that replaces the generic
-- "thank you for your business".
--
-- One row per business (keyed by business_key, mirroring shared.business_config).
-- `settings` is a partial override blob; the curated DEFAULTS live in code
-- (services/document-copy.js) and are deep-merged at render time, so an empty
-- row simply means "use the curated defaults". Shape:
--   {
--     "invoice": { "pdf": {note_label,note,message}, "email": {subject,heading,body,signoff} },
--     "receipt": { "pdf": {note_label,note,message}, "email": {intro,signoff} }
--   }
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.document_settings (
  business_key  TEXT PRIMARY KEY,
  settings      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_by    UUID,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  shared.document_settings IS
  'Per-brand editable copy for invoice/receipt PDFs + their mail (Invoicing → Settings). Overrides deep-merged over code DEFAULTS (services/document-copy.js).';
COMMENT ON COLUMN shared.document_settings.settings IS
  'Partial override blob: { invoice:{pdf,email}, receipt:{pdf,email} }. Empty = use curated defaults.';

-- Seed an (empty) row for every active business so the Settings tab loads a
-- row to edit; defaults still apply until an operator customises a field.
INSERT INTO shared.document_settings (business_key)
SELECT business_key FROM shared.business_config
ON CONFLICT (business_key) DO NOTHING;
