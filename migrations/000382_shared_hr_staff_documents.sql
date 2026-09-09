-- ============================================================
-- MIGRATION 000382 — Employee documents: the type catalogue
-- Pixie Girl Hub · V2.2 §6.11 (HR & Staff) / §6.13 (Documents)
--
-- HR & Staff → Employee → **Documents** tab. An employee's paper trail
-- (contract, guarantor form, NIN slip, passport photo, …) is filed against
-- the staff profile, uploaded as PDFs or images.
--
-- WHERE THE FILES LIVE
-- The files themselves are ordinary `shared.documents` rows — that table is
-- already the tamper-proof registry for every file in the system (storage
-- key, size, mime type, SHA-256 content hash, uploader, soft-delete) and
-- documents.service.store() already does compression, HEIC→JPEG conversion
-- and duplicate collapsing. An employee document is simply:
--
--     reference_type = 'staff_profile'
--     reference_id   = staff_profiles.profile_id
--     document_type  = hr_document_types.type_key
--
-- so nothing about file handling is reinvented here.
--
-- WHY THEY ARE FENCED OFF FROM THE DOCUMENTS MODULE
-- These are the most sensitive files the Hub holds: a NIN slip or a signed
-- contract identifies a person and their pay. The generic /documents module
-- is gated on the `documents` permission, which is granted far more widely
-- than `hr_payroll` — so an accountant with Documents access would otherwise
-- be able to list and download every employee's ID. The API therefore
-- excludes reference_type = 'staff_profile' from the Documents module
-- entirely (list, fetch, download, delete) and serves these files only
-- through HR-gated routes under /hr, plus /hr/me/documents where a staff
-- member reads their own file back. See src/shared/hr_payroll/
-- staff_documents.* and the guard in src/shared/documents/documents.repo.js.
--
-- WHAT THIS MIGRATION ADDS
-- Only the catalogue of document *types*, because that is the part the
-- operator curates. It is per-brand (PXG and FLH each keep their own list),
-- seeded with the four types HR asked for plus the usual suspects, and
-- extensible from the upload drawer itself ("+ New type"). Types carry:
--
--   is_required  — drives the "still missing" checklist on the tab, so an
--                  incomplete file is visible rather than discovered later.
--   accepts      — 'any' | 'pdf' | 'image'; a passport photo is a photo, and
--                  rejecting a 40-page PDF at upload beats finding it there.
--   is_system    — seeded types can be renamed, reordered, marked
--                  required/not, and archived, but never hard-deleted: rows
--                  in shared.documents reference type_key, and deleting the
--                  type would orphan the label a document is filed under.
--
-- Archiving (is_active = false) hides a type from the picker while leaving
-- already-filed documents readable — the honest way to retire a type.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.hr_document_types (
  type_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Stable slug written into shared.documents.document_type. Never changes,
  -- so renaming a type relabels every document already filed under it.
  type_key      TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  description   TEXT,
  is_required   BOOLEAN     NOT NULL DEFAULT false,
  accepts       TEXT        NOT NULL DEFAULT 'any'
                CHECK (accepts IN ('any', 'pdf', 'image')),
  sort_order    INTEGER     NOT NULL DEFAULT 100,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  is_system     BOOLEAN     NOT NULL DEFAULT false,
  created_by    UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, type_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_document_types_business
  ON shared.hr_document_types (business, is_active, sort_order);

COMMENT ON TABLE shared.hr_document_types IS
  'Per-brand catalogue of employee document types (HR & Staff → Employee → Documents). type_key is written to shared.documents.document_type; the files ride shared.documents with reference_type=''staff_profile''.';
COMMENT ON COLUMN shared.hr_document_types.type_key IS
  'Stable slug stored on shared.documents.document_type. Immutable — rename `label` instead.';
COMMENT ON COLUMN shared.hr_document_types.is_required IS
  'Drives the "missing documents" checklist on an employee''s Documents tab.';
COMMENT ON COLUMN shared.hr_document_types.accepts IS
  'Upload guard: any | pdf | image. A passport photo is an image; a contract is normally a PDF.';
COMMENT ON COLUMN shared.hr_document_types.is_system IS
  'Seeded type: editable and archivable, never hard-deletable (documents reference type_key).';

-- ── Seeding ───────────────────────────────────────────────────────────────
-- The default catalogue lives in a function rather than a bare INSERT because
-- it has two callers and must not drift between them:
--
--   · this migration, for the businesses that already exist (production);
--   · scripts/bootstrap-business.js, when a NEW business is created.
--
-- The second caller is not optional. shared.business_config is populated by
-- the bootstrap script, which runs AFTER the shared migrations — so on a fresh
-- provision a plain `INSERT … SELECT FROM business_config` here would seed
-- nothing at all and HR would open a Documents tab with no types to file
-- under. Keeping the list in one function means either path produces the same
-- catalogue.
--
-- Idempotent per business: ON CONFLICT DO NOTHING, so re-running it never
-- resurrects a type an operator has archived or duplicates one they renamed.
CREATE OR REPLACE FUNCTION shared.fn_seed_hr_document_types(p_business TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  INSERT INTO shared.hr_document_types
    (business, type_key, label, description, is_required, accepts,
     sort_order, is_system)
  SELECT p_business, t.type_key, t.label, t.description,
         t.is_required, t.accepts, t.sort_order, true
  FROM (VALUES
    ('contract',       'Employment Contract', 'Signed contract of employment',                     true,  'any',    10),
    ('guarantor_form', 'Guarantor Form',      'Completed and signed guarantor form',               true,  'any',    20),
    ('nin',            'NIN Slip',            'National Identification Number slip or card',       true,  'any',    30),
    ('passport_photo', 'Passport Photograph', 'Recent passport photograph',                        true,  'image',  40),
    ('offer_letter',   'Offer Letter',        'Signed offer / appointment letter',                 false, 'any',    50),
    ('cv',             'CV / Résumé',         'Curriculum vitae as submitted',                     false, 'any',    60),
    ('certificate',    'Certificate',         'Academic or professional certificate',              false, 'any',    70),
    ('bank_details',   'Bank Details',        'Account confirmation letter or statement header',   false, 'any',    80),
    ('medical',        'Medical Report',      'Pre-employment or periodic medical report',         false, 'any',    90),
    ('reference',      'Reference Letter',    'Reference or recommendation from a prior employer', false, 'any',   100),
    ('id_card',        'Government ID',       'Driver''s licence, voter''s card or passport',      false, 'any',   110),
    ('other',          'Other',               'Anything that does not fit another type',           false, 'any',   900)
  ) AS t(type_key, label, description, is_required, accepts, sort_order)
  ON CONFLICT (business, type_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION shared.fn_seed_hr_document_types(TEXT) IS
  'Seeds the default employee document types for one business. Called by migration 000382 for existing businesses and by scripts/bootstrap-business.js for new ones. Idempotent.';

-- Seed every business that already exists. On a fresh provision this is a
-- no-op (business_config is still empty) and the bootstrap script does it.
DO $$
DECLARE
  b RECORD;
BEGIN
  FOR b IN SELECT business_key FROM shared.business_config LOOP
    PERFORM shared.fn_seed_hr_document_types(b.business_key);
  END LOOP;
END;
$$;
