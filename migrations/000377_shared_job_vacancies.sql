-- ============================================================
-- 000377_shared_job_vacancies
--
-- Vacancy-first hiring (HR & Staff → Vacancies tab). This is the stage
-- that PRECEDES the existing offer-first flow (000318_shared_recruitment):
--
--   Create a vacancy (conversational AI intake → Gemini drafts the whole
--   JD + requirements + work model + salary band + 5 strategic screening
--   questions) → publish it to the brand's public Careers page → candidates
--   apply on a public, no-login form (CV + headshot + up to 3 work images +
--   links + skills + desired salary) → the team tracks applicants through a
--   pipeline (New → Screening → Shortlisted → Interviewed → Offered/Rejected)
--   with an AI match score, per-user star ratings and internal notes → the
--   hiring manager answers the 5 AI questions (the ideal-candidate rubric) and
--   the AI re-ranks the shortlist → moving an applicant to "Offered" spawns a
--   recruitment_offer (the existing Offer Studio takes over from there).
--
-- Everything is cross-brand (shared schema); each row carries a `business`
-- key for the issuing brand and is filtered by it at the application layer,
-- exactly like shared.recruitment_offers.
--
-- Fully idempotent: CREATE TABLE/INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS.
-- The runner wraps this file in its own transaction — no BEGIN/COMMIT here.
-- ============================================================

-- ── job_vacancies ──────────────────────────────────────────
-- The rich internal vacancy definition. Distinct from the thin legacy
-- shared.job_openings (left untouched): this carries the workplace model,
-- structured NGN salary band, requirements, reviewers (roles, not people),
-- the public-form config and the conversational intake used to draft it.
CREATE TABLE IF NOT EXISTS shared.job_vacancies (
  vacancy_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,

  title             TEXT        NOT NULL,
  -- Public careers URL segment (/careers/<slug>). Unique so links never clash;
  -- the service generates it from the title + a short suffix.
  slug              TEXT        UNIQUE,

  -- Department links to the org tree (org & workflow). We keep both the FK and
  -- a text snapshot so a renamed/removed unit never blanks a historical vacancy.
  org_unit_id       UUID        REFERENCES shared.org_units (unit_id) ON DELETE SET NULL,
  department        TEXT,

  -- The Pixie Hub permission role granted to whoever is eventually hired.
  role_id           UUID        REFERENCES shared.roles (role_id) ON DELETE SET NULL,

  employment_type   TEXT        NOT NULL DEFAULT 'full_time'
                    CHECK (employment_type IN ('full_time','part_time','contract','internship')),

  -- Workplace model + the on-site / off-site / off day split and working hours.
  workplace_model   TEXT        NOT NULL DEFAULT 'on_site'
                    CHECK (workplace_model IN ('remote','hybrid','on_site')),
  days_on_site      INTEGER,
  days_off_site     INTEGER,
  days_off          INTEGER,
  working_hours     TEXT,                       -- e.g. '9am–5pm, Mon–Fri'

  -- Location (critical for on-site / hybrid roles).
  location_city     TEXT,
  location_state    TEXT,
  location_country  TEXT,

  probation_months  INTEGER,

  -- Structured salary band (numeric so the AI can compare a candidate's desired
  -- salary against it). salary_hidden toggles visibility on the public page.
  salary_min        NUMERIC(14,2),
  salary_max        NUMERIC(14,2),
  salary_currency   TEXT        NOT NULL DEFAULT 'NGN',
  salary_period     TEXT        NOT NULL DEFAULT 'month'
                    CHECK (salary_period IN ('hour','day','month','year')),
  salary_hidden     BOOLEAN     NOT NULL DEFAULT false,

  jd_markdown           TEXT,                   -- core responsibilities / expectations
  requirements_markdown TEXT,                   -- skills, certifications, min experience

  target_start_date DATE,
  headcount         INTEGER     NOT NULL DEFAULT 1,
  target_businesses TEXT[]      NOT NULL DEFAULT '{}',   -- brands the role serves

  -- Hiring manager + reviewers are ROLES/positions, not named people
  -- (per the CEO: "employee picker for the role only, no name").
  hiring_manager_position_id UUID  REFERENCES shared.org_positions (position_id) ON DELETE SET NULL,
  reviewer_position_ids      UUID[] NOT NULL DEFAULT '{}',

  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','paused','closed','filled')),

  -- Per-vacancy public-form configuration (which extra fields to request):
  --   { request_headshot, request_work_images, max_work_images,
  --     require_cover_letter, require_portfolio_links }
  apply_config      JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- The conversational intake answers the AI drafted from (audit + re-draft).
  intake            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ai_provider       TEXT,                       -- which model drafted it

  published_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_vacancies_business ON shared.job_vacancies (business, status);
CREATE INDEX IF NOT EXISTS idx_job_vacancies_slug     ON shared.job_vacancies (slug);
CREATE INDEX IF NOT EXISTS idx_job_vacancies_unit     ON shared.job_vacancies (org_unit_id);

DROP TRIGGER IF EXISTS trg_job_vacancies_updated_at ON shared.job_vacancies;
CREATE TRIGGER trg_job_vacancies_updated_at
  BEFORE UPDATE ON shared.job_vacancies
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── vacancy_screening_questions ────────────────────────────
-- The 5 AI-generated, role-specific strategic questions. The candidate NEVER
-- sees these — the hiring manager answers them to define the "ideal candidate"
-- rubric, and the AI scores/re-ranks applicants against those answers.
CREATE TABLE IF NOT EXISTS shared.vacancy_screening_questions (
  question_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id        UUID        NOT NULL REFERENCES shared.job_vacancies (vacancy_id) ON DELETE CASCADE,
  position          INTEGER     NOT NULL,       -- 1..N display order
  question          TEXT        NOT NULL,
  rationale         TEXT,                       -- why the AI asked it (optional)
  answer            TEXT,                       -- the hiring manager's rubric answer
  weight            SMALLINT    NOT NULL DEFAULT 1,
  answered_by       UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  answered_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, position)
);
CREATE INDEX IF NOT EXISTS idx_vacancy_questions_vacancy
  ON shared.vacancy_screening_questions (vacancy_id, position);

DROP TRIGGER IF EXISTS trg_vacancy_questions_updated_at ON shared.vacancy_screening_questions;
CREATE TRIGGER trg_vacancy_questions_updated_at
  BEFORE UPDATE ON shared.vacancy_screening_questions
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── job_applications ───────────────────────────────────────
-- A candidate's application to a vacancy. Public, no-login submission; the
-- team then works it through the pipeline. One application per email per
-- vacancy (a re-submission UPDATES the existing row — dedupe by update).
CREATE TABLE IF NOT EXISTS shared.job_applications (
  application_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id        UUID        NOT NULL REFERENCES shared.job_vacancies (vacancy_id) ON DELETE CASCADE,
  business          TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,

  -- Contact details.
  full_name         TEXT        NOT NULL,
  email             CITEXT      NOT NULL,
  phone             TEXT,
  address           TEXT,

  -- Cover letter: free text OR an uploaded file (stored via storage.service;
  -- we keep the storage key + metadata, not a documents.* row).
  cover_letter_text     TEXT,
  cover_letter_key      TEXT,
  cover_letter_filename TEXT,
  cover_letter_mime     TEXT,

  -- CV / resume upload (may be a PDF, a doc, OR an image of a CV — Gemini vision
  -- reads all three). cv_text holds the extracted text used for scoring/search.
  cv_key            TEXT,
  cv_filename       TEXT,
  cv_mime           TEXT,
  cv_text           TEXT,

  -- Optional corporate headshot (internal-only — never shown on a public page).
  headshot_key      TEXT,
  headshot_mime     TEXT,

  -- Professional links: [{ label, url }] (LinkedIn / GitHub / Behance / IG / web).
  portfolio_links   JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- Availability + comp expectations.
  notice_period         TEXT,                   -- 'immediate' | '2_weeks' | '1_month' | …
  desired_salary        NUMERIC(14,2),
  desired_salary_currency TEXT     NOT NULL DEFAULT 'NGN',
  desired_salary_text   TEXT,                   -- raw as typed (audit)

  -- Skill sets with experience: [{ skill, years }].
  skills            JSONB       NOT NULL DEFAULT '[]'::jsonb,

  source            TEXT,                       -- "how did you hear about this?"

  -- Pipeline.
  stage             TEXT        NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new','screening','shortlisted','interviewed','offered','rejected','withdrawn')),

  -- Latest AI match score (denormalised from job_application_scores for sorting).
  match_score       NUMERIC(5,2),               -- 0..100
  match_summary     TEXT,                       -- one-line "why"
  match_stage       TEXT,                       -- 'provisional' | 'rubric'

  -- The transition link: set when the applicant is moved to "Offered".
  offer_id          UUID        REFERENCES shared.recruitment_offers (offer_id) ON DELETE SET NULL,

  applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  submit_ip         TEXT,
  submit_ua         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, email)
);
CREATE INDEX IF NOT EXISTS idx_job_applications_vacancy ON shared.job_applications (vacancy_id, stage);
CREATE INDEX IF NOT EXISTS idx_job_applications_business ON shared.job_applications (business);
CREATE INDEX IF NOT EXISTS idx_job_applications_email    ON shared.job_applications (email);
CREATE INDEX IF NOT EXISTS idx_job_applications_score    ON shared.job_applications (vacancy_id, match_score DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_job_applications_updated_at ON shared.job_applications;
CREATE TRIGGER trg_job_applications_updated_at
  BEFORE UPDATE ON shared.job_applications
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── job_application_media ──────────────────────────────────
-- The candidate's up-to-3 work-sample images ("past successes"), each with an
-- optional caption. Stored via storage.service (key + metadata). Internal-only.
CREATE TABLE IF NOT EXISTS shared.job_application_media (
  media_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID        NOT NULL REFERENCES shared.job_applications (application_id) ON DELETE CASCADE,
  storage_key       TEXT        NOT NULL,
  filename          TEXT,
  mime              TEXT,
  size_bytes        BIGINT,
  caption           TEXT,
  display_order     INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_application_media_app
  ON shared.job_application_media (application_id, display_order);

-- ── job_application_notes ──────────────────────────────────
-- Internal comments — team feedback after screening / interviews.
CREATE TABLE IF NOT EXISTS shared.job_application_notes (
  note_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID        NOT NULL REFERENCES shared.job_applications (application_id) ON DELETE CASCADE,
  author_id         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  body              TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_application_notes_app
  ON shared.job_application_notes (application_id, created_at);

-- ── job_application_ratings ────────────────────────────────
-- Per-user 1–5 star ratings for quick screening comparisons. One row per
-- (application, rater); the UI shows the average plus the caller's own stars.
CREATE TABLE IF NOT EXISTS shared.job_application_ratings (
  rating_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID        NOT NULL REFERENCES shared.job_applications (application_id) ON DELETE CASCADE,
  rater_id          UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  stars             SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, rater_id)
);
CREATE INDEX IF NOT EXISTS idx_job_application_ratings_app
  ON shared.job_application_ratings (application_id);

DROP TRIGGER IF EXISTS trg_job_application_ratings_updated_at ON shared.job_application_ratings;
CREATE TRIGGER trg_job_application_ratings_updated_at
  BEFORE UPDATE ON shared.job_application_ratings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── job_application_scores ─────────────────────────────────
-- AI match-score records. A provisional score is written on submit (CV +
-- skills + desired-salary fit vs the JD); once the hiring manager answers the
-- screening questions, a sharper 'rubric' score is written. History is kept
-- (one row per scoring run); the latest is denormalised onto job_applications.
CREATE TABLE IF NOT EXISTS shared.job_application_scores (
  score_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID        NOT NULL REFERENCES shared.job_applications (application_id) ON DELETE CASCADE,
  vacancy_id        UUID        NOT NULL REFERENCES shared.job_vacancies (vacancy_id) ON DELETE CASCADE,
  score             NUMERIC(5,2) NOT NULL,       -- 0..100
  summary           TEXT,                        -- short "why"
  breakdown         JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- per-dimension fit
  scoring_stage     TEXT        NOT NULL DEFAULT 'provisional'
                    CHECK (scoring_stage IN ('provisional','rubric')),
  ai_provider       TEXT,
  model             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_application_scores_app
  ON shared.job_application_scores (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_application_scores_vacancy
  ON shared.job_application_scores (vacancy_id, score DESC);
