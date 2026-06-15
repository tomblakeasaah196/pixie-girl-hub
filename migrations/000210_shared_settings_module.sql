-- ============================================================
-- 000210_shared_settings_module
--
-- Backend plumbing for the complete Settings module. The core
-- config tables (currencies, currency_rates, tax_rates,
-- document_numbering, custom_field_defs, pipeline_stage_defs,
-- bank_accounts, payment_gateways) already exist (000002 / 000116);
-- this migration adds what the full Settings build needs on top:
--
--   1. tax_rates.excluded_modules  — a tax is defined ONCE here and
--      consumed system-wide. Disabling it (is_active=false) removes it
--      everywhere; excluded_modules lets an admin keep a tax active but
--      switch it OFF for specific modules (e.g. VAT on but excluded from
--      'pos'). The tax resolver other modules call honours both.
--
--   2. shared.document_templates — per-brand, per-doc-type templates
--      (Invoice / PO / Delivery Note / Receipt / Contract / Quotation …)
--      with header/body/footer HTML + css_vars. The PDF + email
--      renderers read the active default per (business, doc_type) and
--      fall back to the built-in master when none is set. Versioned so
--      an edit never destroys the previous copy.
--
--   3. shared.notification_preferences — per-user × channel × category
--      matrix. Users manage their own; CEO sees org defaults.
--
--   4. shared.scheduled_reports — saved report definitions (source
--      module + params) with cadence + recipients + formats. A cron
--      worker (separate change) reads is_active rows due at next_run_at.
--      Each report is tied to a source_module/event so delivery can be
--      automated.
--
--   5. shared.integration_secrets — generic encrypted secret store for
--      third-party API keys (shipping, email/SMS providers, etc.) that
--      aren't gateway credentials. AES-256-GCM at rest (encryption.
--      service), WRITE-ONLY at the API: secrets are never returned, only
--      { configured, last4, updated_at }. Rotated by overwrite. This is
--      the secure alternative to writing keys into .env at runtime.
--
-- Idempotent throughout (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- ON CONFLICT DO NOTHING) so re-running is safe.
-- ============================================================

-- ── 1. tax_rates: cross-module exclusion ────────────────────
ALTER TABLE shared.tax_rates
  ADD COLUMN IF NOT EXISTS excluded_modules TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN shared.tax_rates.excluded_modules IS
  'Module keys where this tax is suppressed even when is_active=true (e.g. {pos,storefront}). Empty = applies everywhere the tax_type is relevant.';


-- ── 2. shared.document_templates ────────────────────────────
CREATE TABLE IF NOT EXISTS shared.document_templates (
  template_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  business        TEXT         NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Aligned with shared.document_numbering.document_type values.
  doc_type        TEXT         NOT NULL,
  name            TEXT         NOT NULL,
  version         INT          NOT NULL DEFAULT 1,
  status          TEXT         NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','archived')),
  -- Render parts. Tokens like {{customer_name}} / {{line_items}} are
  -- substituted by the renderer; css_vars carries brand colours/fonts
  -- so a Pixie doc and a Faitlyn doc differ without code changes.
  header_html     TEXT,
  body_html       TEXT,
  footer_html     TEXT,
  css_vars        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- Only one default per (business, doc_type) — enforced by the partial
  -- unique index below. The renderer reads this row.
  is_default      BOOLEAN      NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by      UUID         REFERENCES shared.users (user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_document_templates_lookup
  ON shared.document_templates (business, doc_type, status);
-- At most one default per (business, doc_type).
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_templates_default
  ON shared.document_templates (business, doc_type)
  WHERE is_default = true;

DROP TRIGGER IF EXISTS trg_document_templates_updated_at ON shared.document_templates;
CREATE TRIGGER trg_document_templates_updated_at
  BEFORE UPDATE ON shared.document_templates
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();


-- ── 3. shared.notification_preferences ──────────────────────
CREATE TABLE IF NOT EXISTS shared.notification_preferences (
  pref_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  channel         TEXT         NOT NULL
                  CHECK (channel IN ('email','sms','push','in_app')),
  -- Category groups notifications: 'sales','approvals','stock','system',
  -- 'marketing', etc. The producer side maps each notification to one.
  category        TEXT         NOT NULL,
  enabled         BOOLEAN      NOT NULL DEFAULT true,
  -- Optional per-category tuning (quiet hours, thresholds, digest cadence).
  config          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel, category)
);
CREATE INDEX IF NOT EXISTS ix_notification_preferences_user
  ON shared.notification_preferences (user_id);

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON shared.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON shared.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();


-- ── 4. shared.scheduled_reports ─────────────────────────────
CREATE TABLE IF NOT EXISTS shared.scheduled_reports (
  report_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  business        TEXT         NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  name            TEXT         NOT NULL,
  -- The module/dataset the report pulls from + an event hook so the
  -- worker can also fire a report on a domain event, not just a clock.
  source_module   TEXT         NOT NULL,
  trigger_event   TEXT,                                   -- NULL = cadence-only
  params          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  cadence         TEXT         NOT NULL
                  CHECK (cadence IN ('daily','weekly','monthly','quarterly','on_event')),
  recipients      TEXT[]       NOT NULL DEFAULT '{}',     -- email addresses
  formats         TEXT[]       NOT NULL DEFAULT ARRAY['pdf'],
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  next_run_at     TIMESTAMPTZ,
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by      UUID         REFERENCES shared.users (user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_scheduled_reports_due
  ON shared.scheduled_reports (is_active, next_run_at);

DROP TRIGGER IF EXISTS trg_scheduled_reports_updated_at ON shared.scheduled_reports;
CREATE TRIGGER trg_scheduled_reports_updated_at
  BEFORE UPDATE ON shared.scheduled_reports
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();


-- ── 5. shared.integration_secrets ───────────────────────────
-- WRITE-ONLY at the API. The plaintext is never stored or returned:
-- secret_enc holds the AES-256-GCM blob; last4 is a non-sensitive
-- convenience for the UI ("ends in 1234"). Rotated by overwrite.
CREATE TABLE IF NOT EXISTS shared.integration_secrets (
  secret_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL business = platform-wide key; otherwise per-brand.
  business        TEXT         REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Provider + key role, e.g. provider='sendgrid', key_name='api_key',
  -- or provider='terminix_shipping', key_name='secret_key'.
  provider        TEXT         NOT NULL,
  key_name        TEXT         NOT NULL,
  secret_enc      TEXT         NOT NULL,
  last4           TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by      UUID         REFERENCES shared.users (user_id) ON DELETE SET NULL,
  UNIQUE (business, provider, key_name)
);
CREATE INDEX IF NOT EXISTS ix_integration_secrets_lookup
  ON shared.integration_secrets (provider, key_name);

DROP TRIGGER IF EXISTS trg_integration_secrets_updated_at ON shared.integration_secrets;
CREATE TRIGGER trg_integration_secrets_updated_at
  BEFORE UPDATE ON shared.integration_secrets
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();


-- ── 6. shared.business_policies ─────────────────────────────
-- Business / legal policies (Privacy, Refund, Quality Management
-- Statement, Terms, Cookie, Shipping, etc.). SETTINGS owns the
-- content + editing here (single source of truth). STOREFRONT STUDIO
-- reads `is_published = true` rows to decide which ones appear on the
-- public website and where (footer link, dedicated page, etc.) — it
-- does NOT duplicate or own the content.
--
-- `slug` becomes the public URL path under /policies/{slug} when
-- Studio chooses to surface the policy. UNIQUE per (business, slug)
-- so we never get a clashing public URL. Versioned: every save bumps
-- the version, and the renderer reads the latest published row.
CREATE TABLE IF NOT EXISTS shared.business_policies (
  policy_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  business        TEXT         NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  slug            TEXT         NOT NULL,
  title           TEXT         NOT NULL,
  -- 'privacy', 'refund', 'qms', 'terms', 'cookie', 'shipping', 'returns'
  -- — kept TEXT (not enum) so a new policy type doesn't need a migration.
  policy_type     TEXT         NOT NULL,
  body_html       TEXT         NOT NULL DEFAULT '',
  -- Plain-text summary surfaced by search / SmartComm answers; optional.
  summary         TEXT,
  version         INT          NOT NULL DEFAULT 1,
  status          TEXT         NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','archived')),
  -- True when the admin has flipped the policy live. Studio reads this
  -- to know which policies are eligible for the public website.
  is_published    BOOLEAN      NOT NULL DEFAULT false,
  -- The public URL Studio will link to once it chooses to show the
  -- policy. Resolved as /policies/{slug}.
  public_url      TEXT,
  effective_from  DATE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by      UUID         REFERENCES shared.users (user_id) ON DELETE SET NULL,
  UNIQUE (business, slug)
);
CREATE INDEX IF NOT EXISTS ix_business_policies_lookup
  ON shared.business_policies (business, policy_type, is_published);

DROP TRIGGER IF EXISTS trg_business_policies_updated_at ON shared.business_policies;
CREATE TRIGGER trg_business_policies_updated_at
  BEFORE UPDATE ON shared.business_policies
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();


-- ── 7. RBAC grants for the `settings` module key ────────────
-- The new /api/v1/settings/* routes gate on the `settings` module
-- (already a valid module key per shared.permissions). Mirror the
-- business_setup policy: owner/admin full, accountant create/edit,
-- manager/viewer read. CEO bypasses RBAC entirely. Fine-grained
-- per-tile keys are managed dynamically in Org & Workflow.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'settings', a.action, 'all'
FROM (VALUES
        ('11111111-1111-1111-1111-000000000001'::uuid),
        ('11111111-1111-1111-1111-000000000002'::uuid)) r(role_id),
     (VALUES ('view'),('create'),('edit'),('delete'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000005'::uuid, 'settings', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'settings', 'view', 'all'
FROM (VALUES
        ('11111111-1111-1111-1111-000000000003'::uuid),
        ('11111111-1111-1111-1111-000000000006'::uuid)) r(role_id)
ON CONFLICT (role_id, module, action) DO NOTHING;
