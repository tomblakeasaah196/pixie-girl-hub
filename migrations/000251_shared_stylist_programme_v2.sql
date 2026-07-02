-- ============================================================
-- MIGRATION 000251 — Stylist Partner Programme v2 (full §6.26 build-out)
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Closes the §6.26 spec gaps ahead of the portal + admin-module build
-- (see docs/STYLIST_PROGRAMME_IMPLEMENTATION_GUIDE.md — decisions Q1–Q20):
--   · tier lookup (D-2: labels from config, payout multipliers)      [Q9]
--   · programme config (quality-hold days, routing weights, referral
--     commission %, offer window, portal subdomain)                  [Q1/Q13/Q14/Q17]
--   · config-driven brand-alignment questionnaire + responses        [Q6]
--   · vetting rubric reviews (explicit human decisions, never auto)  [Q5]
--   · application fields on partners (socials, ID docs, probation)   [Q5/Q7/Q8]
--   · contract e-sign linkage (badge auto-issues on signature)       [Q10]
--   · quality-hold + tokenised verified customer reviews             [Q14/Q15]
--   · referral links + storefront attribution (two-way earnings)     [Q17]
--   · stylist in-portal notifications                                [Q18]
--   · payout 'pending_approval' state (workflow-gated approval)      [Q16]
--   · credential reset tokens (invite + forgot-password rail)
--
-- New tables (8):
--   stylist_tiers, stylist_programme_config, stylist_questionnaire_questions,
--   stylist_application_responses, stylist_vetting_reviews,
--   stylist_referral_links, stylist_referral_attributions,
--   stylist_notifications
-- ============================================================

-- ── stylist_tiers ─────────────────────────────────────────
-- D-2: Certified → Pro → Elite rendered from config, never hard-coded.
-- payout_multiplier is snapshotted onto assignments at acceptance.
CREATE TABLE shared.stylist_tiers (
  tier_key              TEXT        PRIMARY KEY,
  label                 TEXT        NOT NULL,
  rank                  SMALLINT    NOT NULL,
  payout_multiplier     NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (payout_multiplier > 0),
  validity_months       SMALLINT    NOT NULL DEFAULT 12 CHECK (validity_months > 0),
  badge_color           TEXT,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stylist_tiers_updated_at
  BEFORE UPDATE ON shared.stylist_tiers
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

INSERT INTO shared.stylist_tiers (tier_key, label, rank, payout_multiplier, validity_months, badge_color, display_order) VALUES
  ('certified', 'Certified', 1, 1.00, 12, '#690909', 1),
  ('pro',       'Pro',       2, 1.10, 12, '#8a6d1d', 2),
  ('elite',     'Elite',     3, 1.25, 12, '#1d5c8a', 3);

-- ── stylist_programme_config ──────────────────────────────
-- One row per business running the programme (PXG only at launch — Q4).
CREATE TABLE shared.stylist_programme_config (
  business              TEXT        PRIMARY KEY REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  quality_hold_days     SMALLINT    NOT NULL DEFAULT 7 CHECK (quality_hold_days >= 0),
  offer_window_hours    SMALLINT    NOT NULL DEFAULT 24 CHECK (offer_window_hours > 0),
  offer_top_n           SMALLINT    NOT NULL DEFAULT 3 CHECK (offer_top_n > 0),
  -- Relative weights for the routing score (Q13); sum is normalised at read.
  routing_weights       JSONB       NOT NULL DEFAULT
    '{"distance":40,"tier":20,"rating":20,"capacity":10,"specialty":10}'::jsonb,
  referral_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (referral_commission_pct >= 0),
  applications_open     BOOLEAN     NOT NULL DEFAULT true,
  -- Contract template: a shared.documents row holding the HTML/PDF template.
  contract_template_doc_id UUID     REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  portal_subdomain      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stylist_programme_config_updated_at
  BEFORE UPDATE ON shared.stylist_programme_config
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

INSERT INTO shared.stylist_programme_config (business, portal_subdomain)
SELECT business_key, 'style.pixiegirlglobal.com'
  FROM shared.business_config WHERE business_key = 'pixiegirl'
ON CONFLICT (business) DO NOTHING;

-- ── stylist_questionnaire_questions ───────────────────────
-- Config-driven brand-alignment questionnaire (Q6). The public application
-- form renders from this; Marketing edits it in the admin module.
CREATE TABLE shared.stylist_questionnaire_questions (
  question_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question              TEXT        NOT NULL,
  help_text             TEXT,
  field_type            TEXT        NOT NULL DEFAULT 'textarea'
                        CHECK (field_type IN ('text','textarea','select','boolean')),
  options               JSONB,                                   -- select choices
  weight                NUMERIC(5,2) NOT NULL DEFAULT 0,         -- rubric weighting hint
  is_required           BOOLEAN     NOT NULL DEFAULT true,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stylist_questionnaire_questions_updated_at
  BEFORE UPDATE ON shared.stylist_questionnaire_questions
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

INSERT INTO shared.stylist_questionnaire_questions
  (question, help_text, field_type, options, weight, is_required, display_order) VALUES
  ('Why do you want to partner with Pixie Girl Global?',
   'Tell us what drew you to the programme and what you hope to build with us.',
   'textarea', NULL, 25, true, 1),
  ('How many wig installs or styling clients do you serve per month?',
   NULL, 'select', '["0–5","6–15","16–30","30+"]'::jsonb, 20, true, 2),
  ('Describe your experience with lace wig installation and customisation.',
   'Techniques, hair types, years of practice — specifics help your review.',
   'textarea', NULL, 25, true, 3),
  ('Do you operate from a registered salon or studio?',
   NULL, 'boolean', NULL, 15, true, 4),
  ('What does the Pixie Girl brand mean to you, and how would you represent it?',
   NULL, 'textarea', NULL, 15, true, 5);

-- ── stylist_application_responses ─────────────────────────
CREATE TABLE shared.stylist_application_responses (
  response_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  question_id           UUID        NOT NULL REFERENCES shared.stylist_questionnaire_questions (question_id) ON DELETE CASCADE,
  answer                JSONB       NOT NULL,                    -- string | bool
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stylist_id, question_id)
);
CREATE INDEX idx_stylist_app_responses_stylist
  ON shared.stylist_application_responses (stylist_id);

-- ── stylist_vetting_reviews ───────────────────────────────
-- Rubric-scored human reviews (Q5). Auto-approval is never used (§6.26):
-- decisions are separate explicit admin actions on the partner lifecycle.
CREATE TABLE shared.stylist_vetting_reviews (
  review_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  reviewer_user_id      UUID        NOT NULL REFERENCES shared.users (user_id),
  rubric                JSONB       NOT NULL,                    -- [{criterion, score, max}]
  total_score           NUMERIC(5,2) NOT NULL,
  recommendation        TEXT        NOT NULL
                        CHECK (recommendation IN ('advance','reject','hold')),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stylist_vetting_reviews_stylist
  ON shared.stylist_vetting_reviews (stylist_id, created_at DESC);

-- ── stylist_referral_links ────────────────────────────────
-- Two-way earnings (Q17): a stylist shares a tracked link; attributed wig
-- sales accrue commission into the same payout rail as assignments.
CREATE TABLE shared.stylist_referral_links (
  link_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  code                  TEXT        NOT NULL UNIQUE,
  label                 TEXT,
  target_path           TEXT,                                    -- storefront path ('' = home)
  clicks                INTEGER     NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stylist_referral_links_updated_at
  BEFORE UPDATE ON shared.stylist_referral_links
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_stylist_referral_links_stylist
  ON shared.stylist_referral_links (stylist_id) WHERE is_active = true;

-- ── stylist_referral_attributions ─────────────────────────
-- One row per attributed paid order. order_id is a soft FK into the brand
-- schema (same pattern as stylist_assignments.reference_id).
CREATE TABLE shared.stylist_referral_attributions (
  attribution_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  referral_code         TEXT        NOT NULL,
  order_id              UUID        NOT NULL,
  order_number          TEXT,
  order_total_ngn       NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_amount_ngn NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency              TEXT        NOT NULL DEFAULT 'NGN' REFERENCES shared.currencies (currency_code),
  status                TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','payable','paid','void')),
  payable_at            TIMESTAMPTZ,
  payout_id             UUID        REFERENCES shared.stylist_payouts (payout_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, order_id)
);
CREATE TRIGGER trg_stylist_referral_attributions_updated_at
  BEFORE UPDATE ON shared.stylist_referral_attributions
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_stylist_referral_attr_stylist
  ON shared.stylist_referral_attributions (stylist_id, status);
CREATE INDEX idx_stylist_referral_attr_payable
  ON shared.stylist_referral_attributions (payable_at)
  WHERE status = 'pending';

-- ── stylist_notifications ─────────────────────────────────
-- In-portal notification feed (Q18). Stylists are not shared.users, so the
-- staff notifications table cannot serve them.
CREATE TABLE shared.stylist_notifications (
  notification_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  type                  TEXT        NOT NULL,                    -- 'offer','assignment','payout','certification','contract','application'
  title                 TEXT        NOT NULL,
  body                  TEXT,
  data                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  read_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stylist_notifications_feed
  ON shared.stylist_notifications (stylist_id, created_at DESC);
CREATE INDEX idx_stylist_notifications_unread
  ON shared.stylist_notifications (stylist_id) WHERE read_at IS NULL;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ ALTERATIONS TO EXISTING STYLIST TABLES                             ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Application/vetting fields, contract linkage, referral identity (Q5–Q10, Q17).
ALTER TABLE shared.stylist_partners
  ADD COLUMN instagram_url            TEXT,
  ADD COLUMN youtube_url              TEXT,
  ADD COLUMN website_url              TEXT,
  ADD COLUMN probation_ends_at        TIMESTAMPTZ,
  ADD COLUMN id_document_id           UUID REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  ADD COLUMN business_document_id     UUID REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  ADD COLUMN contract_document_id     UUID REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  ADD COLUMN contract_signature_request_id UUID,                 -- soft FK shared.signature_requests
  ADD COLUMN contract_signed_at       TIMESTAMPTZ,
  ADD COLUMN vetting_decision_note    TEXT,
  ADD COLUMN referral_code            TEXT UNIQUE,
  ADD COLUMN referral_commission_pct  NUMERIC(5,2),              -- NULL → programme config default
  ADD COLUMN avg_rating               NUMERIC(3,2),
  ADD COLUMN rating_count             INTEGER NOT NULL DEFAULT 0;

-- Every partner can refer from day one; partner_code is already unique.
UPDATE shared.stylist_partners
   SET referral_code = lower(partner_code)
 WHERE referral_code IS NULL;

-- Quality-hold + verified customer reviews + disputes (Q14/Q15).
ALTER TABLE shared.stylist_assignments
  ADD COLUMN review_token             TEXT UNIQUE,
  ADD COLUMN satisfaction_confirmed_at TIMESTAMPTZ,
  ADD COLUMN payable_at               TIMESTAMPTZ,
  ADD COLUMN disputed_at              TIMESTAMPTZ,
  ADD COLUMN dispute_reason           TEXT,
  ADD COLUMN dispute_resolved_at      TIMESTAMPTZ,
  ADD COLUMN dispute_resolution       TEXT,
  ADD COLUMN review_hidden            BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_stylist_assignments_payable
  ON shared.stylist_assignments (payable_at)
  WHERE status = 'completed' AND payout_id IS NULL;

-- Assignments completed before the hold existed stay immediately payable;
-- only new completions enter the confirm-or-window gate.
UPDATE shared.stylist_assignments
   SET payable_at = completed_at
 WHERE status = 'completed' AND payable_at IS NULL;

-- Routing analytics: what score/rank the engine gave each offered candidate (Q13).
ALTER TABLE shared.stylist_assignment_offers
  ADD COLUMN match_score              NUMERIC(6,2),
  ADD COLUMN match_rank               SMALLINT;

-- Referral commissions ride the payout rail: a payout line is EITHER an
-- assignment OR a referral attribution (Q17).
ALTER TABLE shared.stylist_payout_lines
  ALTER COLUMN assignment_id DROP NOT NULL,
  ADD COLUMN attribution_id UUID UNIQUE REFERENCES shared.stylist_referral_attributions (attribution_id) ON DELETE RESTRICT,
  ADD COLUMN line_kind TEXT NOT NULL DEFAULT 'assignment'
      CHECK (line_kind IN ('assignment','referral')),
  ADD CONSTRAINT stylist_payout_lines_one_source
      CHECK ((assignment_id IS NOT NULL)::int + (attribution_id IS NOT NULL)::int = 1);

-- Workflow-gated approval (Q16): submit parks the payout in pending_approval;
-- the workflow engine's CEO/Finance route flips it to approved.
ALTER TABLE shared.stylist_payouts
  DROP CONSTRAINT IF EXISTS stylist_payouts_status_check;
ALTER TABLE shared.stylist_payouts
  ADD CONSTRAINT stylist_payouts_status_check
  CHECK (status IN ('draft','pending_approval','approved','processing','paid','failed','cancelled')),
  ADD COLUMN workflow_instance_id UUID;                          -- soft FK shared.workflow_instances

-- Idempotent expiry reminders (Q12).
ALTER TABLE shared.stylist_certifications
  ADD COLUMN reminder_30_sent_at TIMESTAMPTZ,
  ADD COLUMN reminder_7_sent_at  TIMESTAMPTZ;

-- Invite + forgot-password rail (tokenised set-password links).
ALTER TABLE shared.stylist_credentials
  ADD COLUMN reset_token            TEXT,
  ADD COLUMN reset_token_expires_at TIMESTAMPTZ,
  ADD COLUMN invited_at             TIMESTAMPTZ;
CREATE INDEX idx_stylist_credentials_reset
  ON shared.stylist_credentials (reset_token) WHERE reset_token IS NOT NULL;

-- ── hub_stylist grants ────────────────────────────────────
-- Application layer is the authority; grants are the safety net (see 000008).
GRANT SELECT ON
  shared.stylist_tiers,
  shared.stylist_programme_config,
  shared.stylist_questionnaire_questions,
  shared.stylist_application_responses,
  shared.stylist_vetting_reviews,
  shared.stylist_referral_links,
  shared.stylist_referral_attributions,
  shared.stylist_notifications
TO hub_stylist;
GRANT UPDATE (read_at) ON shared.stylist_notifications TO hub_stylist;

-- ============================================================
-- Verify
-- SELECT count(*) FROM information_schema.tables
-- WHERE table_schema = 'shared' AND table_name LIKE 'stylist%';
-- Expected: 15 rows (7 from 000008 + 8 here)
-- ============================================================
