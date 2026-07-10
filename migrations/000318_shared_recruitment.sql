-- ============================================================
-- 000318_shared_recruitment
--
-- Recruitment / Hiring (HR & Staff → Recruitment tab).
--
-- A CEO/HR user answers a short intake → AI (Gemini primary, DeepSeek
-- fallback) drafts a full Job Description + Offer Letter → the drafts are
-- edited in the "Offer Studio" (split-screen edit + live preview) → the
-- candidate's details are entered and the offer approved → a tokenised,
-- no-login "offer packet" link is emailed to the candidate → the candidate
-- reads the JD + Offer Letter and signs at the bottom (the signature runs
-- on the existing e-signature engine, shared/documents/documents.esign.*)
-- → on full signature an employment contract PDF is generated and
-- countersigned on the Company's behalf, and a short "your login details
-- will follow by email" note goes out. A login is NOT created automatically:
-- an admin later clicks "Provision & email credentials", which mints a
-- one-time password and emails it straight to the new hire.
--
-- Everything is cross-brand (shared schema) so the same flow serves both
-- Pixie Girl Global and Faitlyn Hair, and any future role needs no rebuild.
--
-- Fully idempotent: CREATE TABLE/INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS.
-- ============================================================

-- ── recruitment_context ────────────────────────────────────
-- The editable "company context pack" the AI is grounded in so a drafted JD
-- / Offer Letter actually understands the businesses. One row per business
-- key, plus a '*' row for shared/global context. Seeded with sensible
-- defaults (Pixie Girl Global = global/diaspora-first premium hair & beauty;
-- Faitlyn Hair = Nigeria-first, then export) that HR can edit in the UI.
CREATE TABLE IF NOT EXISTS shared.recruitment_context (
  business          TEXT        PRIMARY KEY,   -- 'pixiegirl' | 'faitlynhair' | '*'
  display_name      TEXT,
  summary           TEXT,                       -- what the business is / does
  tone              TEXT,                       -- brand voice for copy
  target_markets    TEXT,                       -- who / where we sell
  non_negotiables   TEXT,                       -- must-haves for any hire here
  signatory_name    TEXT,                       -- who countersigns offers
  signatory_title   TEXT,
  notes             TEXT,                       -- free-form extra context
  updated_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO shared.recruitment_context
  (business, display_name, summary, tone, target_markets, non_negotiables, signatory_name, signatory_title, notes)
VALUES
  ('*', 'Pixie Girl Group',
   'A multi-brand Nigerian hair & beauty group operating two brands — Pixie Girl Global and Faitlyn Hair — from one modern operation (the Hub). Premium quality, strong e-commerce, ambitious growth.',
   'Confident, premium, warm and modern. Speaks to women who want quality and self-expression. Never cheap or gimmicky.',
   'Nigeria as a strong home base, with a serious global ambition — the African diaspora in the US, UK and Canada first, then wider.',
   'A demonstrable, quantifiable track record of results (real numbers, not vanity metrics). Ownership mentality. Culturally fluent across markets.',
   'Faith', 'Chief Executive Officer',
   'Two brands, shared premium DNA, distinct expression per brand. Roles may serve both brands.'),
  ('pixiegirl', 'Pixie Girl Global',
   'The group''s flagship, global-first premium hair & beauty brand. Built to travel across cultures; the international market is the primary target, not the ceiling.',
   'Aspirational, premium, globally-minded. Speaks to a worldwide audience while staying rooted in African excellence.',
   'Global-first: the African/Nigerian diaspora in the US, UK and Canada first (fastest ROI), then broader international markets. Nigeria is the home base.',
   'Proven ability to build a premium brand image that travels internationally; diaspora/Western market fluency.',
   'Faith', 'Chief Executive Officer',
   'This is the brand we most want to take global. Prioritise diaspora go-to-market for speed, then widen.'),
  ('faitlynhair', 'Faitlyn Hair',
   'A trusted, quality-first Nigerian hair brand. Deepening dominance and loyalty at home, with export/diaspora as a phase-two growth lever.',
   'Trustworthy, quality-obsessed, close to the Nigerian customer. Confident but grounded.',
   'Nigeria-first — deepen loyalty and reputation at home; prepare export/diaspora channels next.',
   'Proven ability to grow loyalty and reputation in a competitive local market.',
   'Faith', 'Chief Executive Officer',
   'Win Nigeria first; build the export runway second.')
ON CONFLICT (business) DO NOTHING;

-- ── role_templates ─────────────────────────────────────────
-- Reusable starting points so a future role is a 3-field start. `intake` is
-- the default answers fed to the AI; `content` can hold boilerplate sections.
CREATE TABLE IF NOT EXISTS shared.role_templates (
  template_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT,                       -- null = available to all brands
  title             TEXT        NOT NULL,
  department        TEXT,
  employment_type   TEXT        NOT NULL DEFAULT 'full_time',
  seniority         TEXT,
  intake            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  content           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_role_templates_business ON shared.role_templates (business);

DROP TRIGGER IF EXISTS trg_role_templates_updated_at ON shared.role_templates;
CREATE TRIGGER trg_role_templates_updated_at
  BEFORE UPDATE ON shared.role_templates
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── job_openings ───────────────────────────────────────────
-- A role being hired for. Holds the intake used to draft and the (editable)
-- JD markdown. An opening can produce one or more offers.
CREATE TABLE IF NOT EXISTS shared.job_openings (
  opening_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  title             TEXT        NOT NULL,
  department        TEXT,
  employment_type   TEXT        NOT NULL DEFAULT 'full_time',
  seniority         TEXT,
  location          TEXT,
  headcount         INTEGER     NOT NULL DEFAULT 1,
  target_businesses TEXT[]      NOT NULL DEFAULT '{}',   -- brands the role serves
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','filled','closed')),
  intake            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  jd_markdown       TEXT,
  created_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_openings_business ON shared.job_openings (business, status);

DROP TRIGGER IF EXISTS trg_job_openings_updated_at ON shared.job_openings;
CREATE TRIGGER trg_job_openings_updated_at
  BEFORE UPDATE ON shared.job_openings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── candidates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared.candidates (
  candidate_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  opening_id        UUID        REFERENCES shared.job_openings (opening_id) ON DELETE SET NULL,
  full_name         TEXT        NOT NULL,
  email             CITEXT      NOT NULL,
  phone             TEXT,
  source            TEXT,
  notes             TEXT,
  created_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidates_business ON shared.candidates (business);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON shared.candidates (email);

DROP TRIGGER IF EXISTS trg_candidates_updated_at ON shared.candidates;
CREATE TRIGGER trg_candidates_updated_at
  BEFORE UPDATE ON shared.candidates
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── recruitment_offers ─────────────────────────────────────
-- The heart of the flow. Carries the editable JD + Offer Letter (markdown),
-- structured offer_meta (salary, dates, probation, reporting line — drives
-- the contract), the public signing token, and links to the generated offer
-- packet + contract documents and the e-signature request.
CREATE TABLE IF NOT EXISTS shared.recruitment_offers (
  offer_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  opening_id        UUID        REFERENCES shared.job_openings (opening_id) ON DELETE SET NULL,
  candidate_id      UUID        REFERENCES shared.candidates (candidate_id) ON DELETE SET NULL,

  title             TEXT        NOT NULL,
  candidate_name    TEXT,
  candidate_email   CITEXT,
  target_businesses TEXT[]      NOT NULL DEFAULT '{}',   -- brands the role serves

  jd_markdown       TEXT        NOT NULL DEFAULT '',
  offer_markdown    TEXT        NOT NULL DEFAULT '',
  offer_meta        JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- salary/dates/probation/reporting

  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','viewed','signed','contracted','provisioned','declined','withdrawn')),

  -- No-login signing. public_token = the e-sign signer token (drives /offer/<token>).
  public_token          TEXT    UNIQUE,
  signature_request_id  UUID    REFERENCES shared.signature_requests (request_id) ON DELETE SET NULL,
  offer_document_id     UUID    REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  contract_document_id  UUID    REFERENCES shared.documents (document_id) ON DELETE SET NULL,

  -- What the login gets when an admin provisions it (post-sign, explicit).
  role_ids          UUID[]      NOT NULL DEFAULT '{}',
  is_ceo            BOOLEAN     NOT NULL DEFAULT false,
  provisioned_user_id UUID      REFERENCES shared.users (user_id) ON DELETE SET NULL,

  ai_provider       TEXT,                       -- which model drafted it (gemini/deepseek/template)
  expires_at        TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  signed_at         TIMESTAMPTZ,
  provisioned_at    TIMESTAMPTZ,
  created_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recruitment_offers_business ON shared.recruitment_offers (business, status);
CREATE INDEX IF NOT EXISTS idx_recruitment_offers_candidate ON shared.recruitment_offers (candidate_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_offers_token ON shared.recruitment_offers (public_token);

DROP TRIGGER IF EXISTS trg_recruitment_offers_updated_at ON shared.recruitment_offers;
CREATE TRIGGER trg_recruitment_offers_updated_at
  BEFORE UPDATE ON shared.recruitment_offers
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
