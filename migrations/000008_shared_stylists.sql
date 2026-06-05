-- ============================================================
-- MIGRATION 000008 — Shared stylist partner programme
-- Pixie Girl Hub · JBS Praxis · V2.0
--
-- Module 6.26 (Stylist Partner Programme).
-- Stylists are external partners — not staff. They have their
-- own JWT class and their own portal. All tables live in `shared`
-- because a stylist can take assignments from any brand.
--
-- Tables:
--   stylist_partners       — directory + lifecycle state
--   stylist_credentials    — login (separate from staff users)
--   stylist_specialities   — service catalogue per stylist
--   stylist_certifications — tiered + expiring + linked certificate doc
--   stylist_assignments    — customer routing record
--   stylist_payouts        — Pixie-managed payout batches
--   stylist_payout_lines   — which assignments paid in this batch
-- ============================================================

-- ── stylist_partners ─────────────────────────────────────
CREATE TABLE shared.stylist_partners (
  stylist_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code          TEXT        NOT NULL UNIQUE,            -- 'PXS-0001'
  -- Stylists are also contacts so they can appear in CRM/messaging/etc.
  contact_id            UUID        NOT NULL UNIQUE REFERENCES shared.contacts (contact_id),
  display_name          TEXT        NOT NULL,
  -- Lifecycle
  status                TEXT        NOT NULL DEFAULT 'applicant'
                        CHECK (status IN ('applicant','vetting','vetted','certified','suspended','terminated')),
  application_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  vetted_at             TIMESTAMPTZ,
  vetted_by             UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  suspended_at          TIMESTAMPTZ,
  suspended_reason      TEXT,
  terminated_at         TIMESTAMPTZ,
  terminated_reason     TEXT,
  -- Geography (for nearby-stylist routing)
  country_code          TEXT        NOT NULL,
  city                  TEXT        NOT NULL,
  state                 TEXT,
  latitude              NUMERIC(10,7),
  longitude             NUMERIC(10,7),
  service_radius_km     INTEGER     NOT NULL DEFAULT 25,
  -- Capacity
  max_active_assignments SMALLINT   NOT NULL DEFAULT 5,
  current_active_count   SMALLINT   NOT NULL DEFAULT 0,
  -- Public verification badge (one per stylist; revocable)
  badge_token           TEXT        UNIQUE,                     -- public URL: /verify/badge/{token}
  badge_revoked_at      TIMESTAMPTZ,
  -- Current highest certification tier (denormalised for fast filter)
  current_tier_key      TEXT,                                   -- 'certified','pro','elite' (V2.2 §6.26)
  current_tier_expires_at TIMESTAMPTZ,
  -- Payout
  payout_currency       TEXT        NOT NULL DEFAULT 'NGN' REFERENCES shared.currencies (currency_code),
  payout_bank_name      TEXT,
  payout_account_number TEXT,                                   -- encrypted at app layer
  payout_account_name   TEXT,
  paystack_recipient_code TEXT,                                 -- for automated transfers
  -- Portfolio
  bio                   TEXT,
  portfolio_url         TEXT,
  -- Custom fields per brand programme (configurable via custom_field_defs entity_type='stylist_partner')
  custom_fields         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stylist_partners_updated_at
  BEFORE UPDATE ON shared.stylist_partners
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_stylist_partners_status     ON shared.stylist_partners (status, country_code);
CREATE INDEX idx_stylist_partners_geo        ON shared.stylist_partners (country_code, city, status)
  WHERE status = 'certified';
CREATE INDEX idx_stylist_partners_badge      ON shared.stylist_partners (badge_token) WHERE badge_token IS NOT NULL;
CREATE INDEX idx_stylist_partners_capacity   ON shared.stylist_partners (current_active_count, max_active_assignments)
  WHERE status = 'certified';

-- ── stylist_credentials ──────────────────────────────────
-- Stylist portal login. Kept SEPARATE from shared.users — stylists
-- are not staff, and a single account schema for "anyone who logs in"
-- would invite scope-leak bugs.
CREATE TABLE shared.stylist_credentials (
  credential_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL UNIQUE REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  email                 CITEXT      NOT NULL UNIQUE,
  password_hash         TEXT        NOT NULL,                   -- bcrypt cost ≥12
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  force_password_reset  BOOLEAN     NOT NULL DEFAULT true,
  last_login_at         TIMESTAMPTZ,
  last_login_ip         INET,
  failed_login_attempts SMALLINT    NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stylist_credentials_updated_at
  BEFORE UPDATE ON shared.stylist_credentials
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── stylist_specialities ─────────────────────────────────
-- Service catalogue + per-service rate. Per-brand because the same
-- stylist may serve PXG installs and FLH maintenance at different rates.
CREATE TABLE shared.stylist_specialities (
  speciality_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  service_key           TEXT        NOT NULL,                   -- 'install','maintenance','restyling'
  display_name          TEXT        NOT NULL,
  -- Base rate per job (in stylist's payout currency)
  rate                  NUMERIC(12,2) NOT NULL CHECK (rate >= 0),
  duration_minutes      INTEGER,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  -- Edits to rate/service require admin approval (writes pending row)
  pending_admin_review  BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stylist_id, business, service_key)
);
CREATE TRIGGER trg_stylist_specialities_updated_at
  BEFORE UPDATE ON shared.stylist_specialities
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_stylist_specialities_lookup
  ON shared.stylist_specialities (business, service_key)
  WHERE is_active = true;

-- ── stylist_certifications ───────────────────────────────
-- Tiered certifications. A stylist's current_tier_key on
-- stylist_partners is derived from the latest active row here.
CREATE TABLE shared.stylist_certifications (
  certification_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  -- Tier: 'certified','senior','master' — extensible
  tier_key              TEXT        NOT NULL,
  awarded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  awarded_by            UUID        NOT NULL REFERENCES shared.users (user_id),
  expires_at            TIMESTAMPTZ NOT NULL,
  -- Generated certificate PDF (Puppeteer)
  document_id           UUID        REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  -- Score and feedback from the certification review
  assessment_score      NUMERIC(5,2),
  assessment_notes      TEXT,
  -- Revocation
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  revoked_reason        TEXT,
  is_current            BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stylist_cert_stylist     ON shared.stylist_certifications (stylist_id, awarded_at DESC);
CREATE INDEX idx_stylist_cert_expiring    ON shared.stylist_certifications (expires_at)
  WHERE is_current = true AND revoked_at IS NULL;
CREATE INDEX idx_stylist_cert_active      ON shared.stylist_certifications (stylist_id, tier_key)
  WHERE is_current = true AND revoked_at IS NULL;

-- ── stylist_assignments ──────────────────────────────────
-- Customer-to-stylist routing record. One assignment per service job.
-- Created in 'offered_pool' state — multiple candidates may be notified.
-- First to accept wins; the rest move to 'declined_other_accepted'.
CREATE TABLE shared.stylist_assignments (
  assignment_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_number     TEXT        NOT NULL UNIQUE,            -- 'PXS-ASN-0001'
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE RESTRICT,
  customer_contact_id   UUID        NOT NULL REFERENCES shared.contacts (contact_id),
  -- The order / booking that requested the styling (in the brand schema)
  reference_type        TEXT        NOT NULL CHECK (reference_type IN ('sales_order','service_booking','production_run')),
  reference_id          UUID        NOT NULL,
  service_key           TEXT        NOT NULL,                   -- matches stylist_specialities.service_key
  -- Stylist (set once accepted)
  stylist_id            UUID        REFERENCES shared.stylist_partners (stylist_id) ON DELETE SET NULL,
  -- Lifecycle
  status                TEXT        NOT NULL DEFAULT 'offered_pool'
                        CHECK (status IN ('offered_pool','accepted','declined_by_stylist',
                                          'declined_other_accepted','escalated_to_admin','in_progress',
                                          'completed','cancelled','disputed')),
  -- Offer window
  offered_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  offer_expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at           TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  -- Payout: snapshot of the rate at time of acceptance + computed payout
  base_rate             NUMERIC(12,2),
  tier_multiplier       NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  platform_fee_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,
  gross_payout          NUMERIC(12,2),
  net_payout            NUMERIC(12,2),
  payout_currency       TEXT        REFERENCES shared.currencies (currency_code),
  -- Linked to a payout batch once paid
  payout_id             UUID,                                   -- FK after stylist_payouts
  -- Customer-facing scheduling
  scheduled_at          TIMESTAMPTZ,
  service_address       JSONB,
  -- Customer feedback
  customer_rating       SMALLINT    CHECK (customer_rating BETWEEN 1 AND 5),
  customer_review       TEXT,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stylist_assignments_updated_at
  BEFORE UPDATE ON shared.stylist_assignments
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_stylist_assignments_stylist  ON shared.stylist_assignments (stylist_id, status);
CREATE INDEX idx_stylist_assignments_open     ON shared.stylist_assignments (offer_expires_at)
  WHERE status = 'offered_pool';
CREATE INDEX idx_stylist_assignments_customer ON shared.stylist_assignments (customer_contact_id);
CREATE INDEX idx_stylist_assignments_ref      ON shared.stylist_assignments (reference_type, reference_id);
CREATE INDEX idx_stylist_assignments_complete ON shared.stylist_assignments (stylist_id, completed_at DESC)
  WHERE status = 'completed' AND payout_id IS NULL;

-- ── stylist_assignment_offers ────────────────────────────
-- The many-to-many between an assignment and the candidate stylists
-- who were offered it. Lets us track who saw which offer for analytics
-- and audit.
CREATE TABLE shared.stylist_assignment_offers (
  offer_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id         UUID        NOT NULL REFERENCES shared.stylist_assignments (assignment_id) ON DELETE CASCADE,
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE CASCADE,
  offered_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  response              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (response IN ('pending','accepted','declined','expired','superseded')),
  responded_at          TIMESTAMPTZ,
  decline_reason        TEXT,
  UNIQUE (assignment_id, stylist_id)
);
CREATE INDEX idx_stylist_offers_stylist ON shared.stylist_assignment_offers (stylist_id, response);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ PAYOUTS                                                            ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── stylist_payouts ──────────────────────────────────────
CREATE TABLE shared.stylist_payouts (
  payout_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_number         TEXT        NOT NULL UNIQUE,            -- 'PXS-PO-0001'
  stylist_id            UUID        NOT NULL REFERENCES shared.stylist_partners (stylist_id) ON DELETE RESTRICT,
  -- Period covered by this batch
  period_start          DATE        NOT NULL,
  period_end            DATE        NOT NULL,
  -- Totals (in payout currency)
  currency              TEXT        NOT NULL REFERENCES shared.currencies (currency_code),
  gross_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  platform_fee_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustments_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- For NGN settlement: NGN equivalent + FX rate used
  amount_ngn            NUMERIC(14,2) NOT NULL DEFAULT 0,
  fx_rate_used          NUMERIC(15,6),
  -- Lifecycle
  status                TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','processing','paid','failed','cancelled')),
  -- Paystack transfer
  paystack_transfer_code TEXT,
  paystack_transfer_status TEXT,
  failure_reason        TEXT,
  -- Approval & execution
  approved_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  -- Generated remittance document
  remittance_document_id UUID       REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payout_period_valid CHECK (period_end >= period_start)
);
CREATE TRIGGER trg_stylist_payouts_updated_at
  BEFORE UPDATE ON shared.stylist_payouts
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_stylist_payouts_stylist ON shared.stylist_payouts (stylist_id, period_end DESC);
CREATE INDEX idx_stylist_payouts_status  ON shared.stylist_payouts (status) WHERE status IN ('draft','approved','processing');

-- ── stylist_payout_lines ─────────────────────────────────
CREATE TABLE shared.stylist_payout_lines (
  line_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id             UUID        NOT NULL REFERENCES shared.stylist_payouts (payout_id) ON DELETE CASCADE,
  assignment_id         UUID        NOT NULL UNIQUE REFERENCES shared.stylist_assignments (assignment_id) ON DELETE RESTRICT,
  -- Snapshot at time of payout
  gross_amount          NUMERIC(12,2) NOT NULL,
  platform_fee_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount            NUMERIC(12,2) NOT NULL,
  description           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stylist_payout_lines_payout ON shared.stylist_payout_lines (payout_id);

-- Wire deferred FK on stylist_assignments → stylist_payouts
ALTER TABLE shared.stylist_assignments
  ADD CONSTRAINT fk_stylist_assignments_payout
    FOREIGN KEY (payout_id) REFERENCES shared.stylist_payouts (payout_id) ON DELETE SET NULL;

-- ── Stylist portal role permissions ──────────────────────
-- hub_stylist gets SELECT on its own data; the application layer is
-- the actual access-control authority. These grants stop accidental
-- writes if a stylist token is misrouted to a privileged endpoint.
GRANT SELECT ON
  shared.stylist_partners,
  shared.stylist_specialities,
  shared.stylist_certifications,
  shared.stylist_assignments,
  shared.stylist_assignment_offers,
  shared.stylist_payouts,
  shared.stylist_payout_lines
TO hub_stylist;

GRANT UPDATE (response, responded_at, decline_reason) ON shared.stylist_assignment_offers TO hub_stylist;
-- Updates to assignments (accept / decline / mark in_progress / complete)
-- still go through the application API, NOT direct DML — but the role
-- grant is the safety net.

-- ============================================================
-- Verify
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'shared' AND table_name LIKE 'stylist%';
-- Expected: 7 rows
-- ============================================================
