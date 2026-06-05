-- ============================================================
-- MIGRATION 000002 — Shared system tables
-- Pixie Girl Hub · JBS Praxis · V2.0
--
-- business_config, custom_field_defs, pipeline_stage_defs,
-- document_numbering, tax_rates, currencies, currency_rates,
-- bank_accounts, webhook_log, migrations
-- ============================================================

-- ── currencies ───────────────────────────────────────────
-- The six display currencies at launch + the ability to add more
-- without code changes. NGN is the settlement currency for all books.
CREATE TABLE shared.currencies (
  currency_code         TEXT        PRIMARY KEY,        -- 'NGN','USD','GBP','EUR','CAD','GHS'
  display_name          TEXT        NOT NULL,           -- 'Nigerian Naira'
  symbol                TEXT        NOT NULL,           -- '₦'
  decimal_places        SMALLINT    NOT NULL DEFAULT 2,
  rounding_unit         NUMERIC(10,4) NOT NULL DEFAULT 1, -- e.g. NGN rounds to 100, GBP to 1
  is_settlement         BOOLEAN     NOT NULL DEFAULT false,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── business_config ──────────────────────────────────────
-- One row per active brand. The business_key matches the schema
-- name exactly (e.g. 'pixiegirl', 'faitlynhair'). Bootstrap inserts
-- this row when a new brand is provisioned.
CREATE TABLE shared.business_config (
  config_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_key          TEXT        NOT NULL UNIQUE,    -- schema name, e.g. 'pixiegirl'
  display_name          TEXT        NOT NULL,           -- 'Pixie Girl Global'
  legal_name            TEXT        NOT NULL,           -- 'Pixie Girl Global Ltd'
  trading_currency      TEXT        NOT NULL DEFAULT 'NGN' REFERENCES shared.currencies (currency_code),
  -- Settlement currency for the books — always NGN at launch but kept
  -- explicit so a future non-Nigerian brand can be configured.
  settlement_currency   TEXT        NOT NULL DEFAULT 'NGN' REFERENCES shared.currencies (currency_code),
  document_prefix       TEXT        NOT NULL,           -- 'PXG' or 'FLH' — drives PXG-INV-0001
  -- Storefront identity (Module 6.4 / 6.28)
  storefront_domain     TEXT,                            -- 'pixiegirlglobal.ng' — NULL = no public storefront
  storefront_enabled    BOOLEAN     NOT NULL DEFAULT false,
  -- Module 18 (Business Setup) brand identity
  address               TEXT,
  phone                 TEXT,
  email                 TEXT,
  website               TEXT,
  tin                   TEXT,                            -- Tax Identification Number
  cac_number            TEXT,                            -- CAC registration
  vat_number            TEXT,
  vat_rate              NUMERIC(5,4) NOT NULL DEFAULT 0.075,   -- 7.5% Nigerian VAT
  wht_rate              NUMERIC(5,4) NOT NULL DEFAULT 0.05,    -- 5% Withholding Tax
  fiscal_year_start     SMALLINT    NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  logo_path             TEXT,
  accent_colour         TEXT        DEFAULT '#0A1128',
  mission_statement     TEXT,                            -- Module 18: visible on staff portal
  brand_fonts           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Operational config blobs (kept as JSONB; no normalised equivalent)
  payment_methods       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  cash_handling_rules   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Module 6.23 (Retention) — loyalty programme defaults
  loyalty_settings      JSONB       NOT NULL DEFAULT '{
    "points_per_naira": 0.01,
    "expiry_months": 12,
    "tier_display_in_receipt": true,
    "notify_on_tier_upgrade": true,
    "earn_on_delivery_not_placement": true
  }'::jsonb,
  -- Module 6.4 storefront — cancellation timer rules (3-hour free,
  -- restocking fee thereafter, 50% non-refundable on custom orders).
  cancellation_settings JSONB       NOT NULL DEFAULT '{
    "free_window_hours": 3,
    "restocking_fee_pct": 10,
    "custom_order_non_refundable_pct": 50
  }'::jsonb,
  -- Module 6.4 — PXG quantity discount rule (configurable per brand).
  -- [{"min_qty":2,"discount_amount":10,"currency":"USD"},
  --  {"min_qty":3,"discount_amount":22,"currency":"USD"}]
  quantity_discount_rules JSONB     NOT NULL DEFAULT '[]'::jsonb,
  -- Module 6.6 — inter-company trade settings (PXG ↔ FLH)
  -- {"min_margin_floor_pct": 15, "trading_partners": ["faitlynhair"]}
  intercompany_settings JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- FX provider settings
  fx_settings           JSONB       NOT NULL DEFAULT '{
    "provider": "exchangerate.host",
    "refresh_hour_utc": 2,
    "manual_override_allowed": true
  }'::jsonb,
  -- B-9 (V2.2 §6.25): per-gateway fee schedule. Pricing engine grosses up
  -- net targets through these fees; Accounting books each gateway's fees
  -- to its dedicated 551x sub-account. Editable in Business Setup.
  payment_gateway_fees  JSONB       NOT NULL DEFAULT '{
    "paystack": { "currency": "NGN", "pct": 0.015, "fixed": 0,    "cap_ngn": 2000 },
    "opay":     { "currency": "NGN", "pct": 0.015, "fixed": 0,    "cap_ngn": 2000 },
    "nomba":    { "currency": "NGN", "pct": 0.005, "fixed": 0,    "cap_ngn": 500 },
    "stripe":   { "currency": "INTL", "pct": 0.034, "fixed_usd": 0.30, "cap": null }
  }'::jsonb,
  -- B-2 (V2.2 §6.2): installment payment model defaults & abandonment.
  -- payment_model on each product/variant chooses 'layaway' or
  -- 'deposit_triggered'. These business-level fields are the policy that
  -- the product fallback uses when not overridden per-variant.
  installment_settings  JSONB       NOT NULL DEFAULT '{
    "default_deposit_pct_for_deposit_triggered": 50,
    "layaway_abandonment_days": 60,
    "layaway_reminder_cadence_days": 7,
    "min_partial_payment_ngn": 1000,
    "auto_cancel_after_no_payment": true
  }'::jsonb,
  -- B-2 — separation of duties toggle. OFF at launch (every payment must
  -- come through a gateway). Once a Finance hire is made, CEO flips this
  -- ON to permit manual-bank-transfer entries (which then require a
  -- mandatory bank_transaction_id on the payment record).
  allow_staff_recorded_manual_payments BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_business_config_updated_at
  BEFORE UPDATE ON shared.business_config
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── custom_field_defs ────────────────────────────────────
-- Per-brand custom-field schema used by products, contacts, CRM deals.
-- This drives the dynamic forms in the admin UI.
CREATE TABLE shared.custom_field_defs (
  field_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  entity_type           TEXT        NOT NULL CHECK (entity_type IN ('product','contact','crm_deal','sales_order','stylist_partner')),
  field_key             TEXT        NOT NULL,
  field_label           TEXT        NOT NULL,
  field_type            TEXT        NOT NULL CHECK (field_type IN ('text','number','select','multiselect','date','boolean','url')),
  options               JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- for select/multiselect
  is_required           BOOLEAN     NOT NULL DEFAULT false,
  is_searchable         BOOLEAN     NOT NULL DEFAULT false,
  is_filterable         BOOLEAN     NOT NULL DEFAULT false,
  visible_to_roles      TEXT[]      NOT NULL DEFAULT '{}',          -- empty = visible to all
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, entity_type, field_key)
);
CREATE TRIGGER trg_custom_field_defs_updated_at
  BEFORE UPDATE ON shared.custom_field_defs
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_custom_field_defs_lookup ON shared.custom_field_defs (business, entity_type, is_active);

-- ── pipeline_stage_defs ──────────────────────────────────
CREATE TABLE shared.pipeline_stage_defs (
  stage_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  pipeline_type         TEXT        NOT NULL CHECK (pipeline_type IN ('crm','delivery','purchase_order','production')),
  stage_key             TEXT        NOT NULL,
  stage_label           TEXT        NOT NULL,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  is_terminal           BOOLEAN     NOT NULL DEFAULT false,
  is_positive_terminal  BOOLEAN,                                  -- true=won/delivered, false=lost
  colour                TEXT        DEFAULT '#64748B',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, pipeline_type, stage_key)
);

-- ── document_numbering ───────────────────────────────────
-- Atomic sequence counter per document type per business.
-- Use SELECT … FOR UPDATE in the service layer for safe concurrent
-- increments.
CREATE TABLE shared.document_numbering (
  seq_id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  document_type         TEXT        NOT NULL,
  -- Types: invoice | purchase_order | quotation | sales_order | delivery
  --        payslip | credit_note | settlement | receipt | rfq
  --        transfer | expense | supplier | payroll_run
  --        production_run | stylist_payout | intercompany
  prefix                TEXT        NOT NULL,           -- e.g. 'PXG-INV'
  next_number           INTEGER     NOT NULL DEFAULT 1,
  padding               SMALLINT    NOT NULL DEFAULT 4, -- zero-pad to 4 digits: 0001
  UNIQUE (business, document_type)
);

-- ── tax_rates ────────────────────────────────────────────
CREATE TABLE shared.tax_rates (
  tax_id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  tax_name              TEXT        NOT NULL,   -- 'VAT','WHT','PAYE','Pension_Employee','Pension_Employer','NHF'
  tax_type              TEXT        NOT NULL CHECK (tax_type IN ('sales','purchases','payroll')),
  rate                  NUMERIC(7,4) NOT NULL,
  applies_to            TEXT        NOT NULL,   -- 'all','products','services','salaries','basic'
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  effective_from        DATE        NOT NULL,
  effective_to          DATE,                   -- NULL = currently active
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tax_rates_active ON shared.tax_rates (business, tax_name, effective_from DESC)
  WHERE is_active = true;

-- ── currency_rates ───────────────────────────────────────
-- Daily FX rates from the configured provider, with manual override.
-- All money is stored in NGN; rates are for display + capture-at-sale.
CREATE TABLE shared.currency_rates (
  rate_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency         TEXT        NOT NULL REFERENCES shared.currencies (currency_code),
  to_currency           TEXT        NOT NULL DEFAULT 'NGN' REFERENCES shared.currencies (currency_code),
  rate                  NUMERIC(15,6) NOT NULL,
  source                TEXT,                                 -- 'exchangerate.host','manual'
  is_manual_override    BOOLEAN     NOT NULL DEFAULT false,
  set_by                UUID,                                  -- FK added after users table
  valid_at              TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_currency <> to_currency)
);
CREATE INDEX idx_currency_rates_lookup
  ON shared.currency_rates (from_currency, to_currency, valid_at DESC);

-- ── bank_accounts ────────────────────────────────────────
-- Company bank accounts (NOT staff personal accounts — those are in
-- staff_profiles).
CREATE TABLE shared.bank_accounts (
  account_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  bank_name             TEXT        NOT NULL,
  account_name          TEXT        NOT NULL,
  account_number        TEXT        NOT NULL,
  sort_code             TEXT,
  currency              TEXT        NOT NULL DEFAULT 'NGN' REFERENCES shared.currencies (currency_code),
  is_primary            BOOLEAN     NOT NULL DEFAULT false,
  paystack_recipient_code TEXT,
  opay_account_id TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON shared.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_bank_accounts_business ON shared.bank_accounts (business) WHERE is_active = true;

-- ── webhook_log ──────────────────────────────────────────
-- All inbound webhook payloads are logged BEFORE processing.
-- If processing fails, the row stays and can be replayed.
CREATE TABLE shared.webhook_log (
  webhook_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source                TEXT        NOT NULL,
  -- Sources: paystack | opay | nomba | chowdeck | gigl | dhl
  --          whatsapp | instagram | facebook | tiktok | youtube
  --          google_ads | meta_ads | woocommerce
  event_type            TEXT        NOT NULL,
  payload               JSONB       NOT NULL,
  signature_valid       BOOLEAN     NOT NULL,
  source_ip             INET,
  processed             BOOLEAN     NOT NULL DEFAULT false,
  processed_at          TIMESTAMPTZ,
  error_message         TEXT,
  retry_count           SMALLINT    NOT NULL DEFAULT 0,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_log_unprocessed ON shared.webhook_log (source, processed, received_at)
  WHERE processed = false;
CREATE INDEX idx_webhook_log_received ON shared.webhook_log (source, received_at DESC);

-- ── migrations ───────────────────────────────────────────
-- Tracks which SQL files have been applied. The Node.js migrator
-- reads this before running.
CREATE TABLE shared.migrations (
  migration_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  filename              TEXT        NOT NULL UNIQUE,
  business              TEXT,                                 -- NULL for shared migrations; brand key for per-brand templates
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by            TEXT,                                  -- hostname / environment tag
  checksum              TEXT        NOT NULL,                  -- SHA-256 of file contents (with placeholder substituted)
  execution_ms          INTEGER,
  status                TEXT        NOT NULL DEFAULT 'applied'
                        CHECK (status IN ('applied','failed','rolled_back'))
);
CREATE INDEX idx_migrations_filename ON shared.migrations (filename);
CREATE INDEX idx_migrations_business ON shared.migrations (business) WHERE business IS NOT NULL;

-- ============================================================
-- Verify
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'shared' ORDER BY table_name;
-- Expected: bank_accounts, business_config, currencies, currency_rates,
--           custom_field_defs, document_numbering, migrations,
--           pipeline_stage_defs, tax_rates, webhook_log
-- ============================================================
