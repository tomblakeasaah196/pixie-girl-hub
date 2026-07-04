-- ============================================================
-- 000256 — Unified AI Insights store + per-module control matrix
-- Pixie Girl Hub · JBS Praxis · V2.2 §6.30 / §6.31
--
-- Scales AI Insights from the 7 hardcoded category tables (000012) to a
-- SINGLE unified store that every module writes into, plus a per-module
-- control matrix the CEO drives from AI Control ("pick which modules we
-- want AI on"). Each module page then hosts one reusable insights slot.
--
--   shared.ai_insights          — one row per open finding, any module.
--                                 module + detector + severity + status +
--                                 typed `context` JSONB + a drill target +
--                                 the same open→resolved lifecycle as before.
--   shared.ai_insight_modules   — the AI Control switchboard: one row per
--                                 module with insights_enabled (tier-1 rules),
--                                 narration_enabled (tier-2 AI briefing) and
--                                 frequency. The detector runner + the UI slot
--                                 both gate on this.
--
-- ADDITIVE + SAFE: the legacy per-category tables from 000012 are left in
-- place. Nothing references the new tables until the code cutover ships in
-- the same wave. Because the tier-1 detectors are idempotent on
-- (module, business, suppression_key) and re-run every 30 min, open findings
-- re-materialise into ai_insights on the next sweep — so no data backfill is
-- required, and the legacy tables can be dropped in a later cleanup once the
-- unified path is verified in production.
--
-- Cost note: narration_enabled defaults FALSE for every module. The tier-2
-- capability ships for all 27, but AI (paid) narration only runs where the
-- CEO explicitly flips it on in AI Control — so enabling a module for
-- insights never causes surprise DeepSeek spend. Tier-1 rules are free.
-- ============================================================

-- ── shared.ai_insights ───────────────────────────────────
-- The unified finding. `module` is the nav/permission key (drives the gate
-- + the module-page slot); `detector` is the specific rule within it.
CREATE TABLE shared.ai_insights (
  insight_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  module            TEXT        NOT NULL,                    -- 'stock','purchasing','logistics',…
  detector          TEXT        NOT NULL,                    -- 'reorder_point','po_overdue',…
  -- Entity scope. NULL = cross-brand finding (e.g. inter-company).
  business          TEXT        REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  severity          TEXT        NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','acknowledged','investigating','resolved','dismissed')),
  -- Display
  title             TEXT        NOT NULL,                    -- one-line headline
  body              TEXT,                                    -- optional detail sentence
  -- Typed payload (amounts, ids, thresholds, day counts) for rich rendering.
  context           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Denormalised money so lists can sort/show without unpacking JSON.
  amount_ngn        NUMERIC(14,2),
  -- Drill target — the source record this insight points at.
  source_table      TEXT,
  source_id         UUID,
  drill_route       TEXT,                                    -- e.g. '/invoicing/<uuid>'
  -- Lifecycle actors
  acknowledged_by   UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  acknowledged_at   TIMESTAMPTZ,
  resolved_by       UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  -- Idempotency: a re-raise of the same finding while still open must not
  -- create a duplicate (enforced by the partial-unique index below).
  suppression_key   TEXT        NOT NULL,
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_ai_insights_updated_at
  BEFORE UPDATE ON shared.ai_insights
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- Open-list read: "open insights for this brand + module, worst/newest first".
CREATE INDEX idx_ai_insights_open
  ON shared.ai_insights (business, module, severity, detected_at DESC)
  WHERE status = 'open';
-- Summary counts per module/status.
CREATE INDEX idx_ai_insights_module_status
  ON shared.ai_insights (module, status);
-- Drill-back from a source record to its open insight(s).
CREATE INDEX idx_ai_insights_source
  ON shared.ai_insights (source_table, source_id)
  WHERE source_id IS NOT NULL;
-- Suppression: one OPEN finding per (module, business, key). COALESCE keeps
-- cross-brand (NULL business) findings unique too.
CREATE UNIQUE INDEX idx_ai_insights_suppression
  ON shared.ai_insights (module, COALESCE(business, '*'), suppression_key)
  WHERE status IN ('open','acknowledged','investigating');

-- ── shared.ai_insight_modules ────────────────────────────
-- The AI Control matrix. One row per module; the CEO toggles insights
-- (tier-1 rules), narration (tier-2 AI briefing) and frequency here.
CREATE TABLE shared.ai_insight_modules (
  module              TEXT        PRIMARY KEY,
  display_name        TEXT        NOT NULL,
  -- The RBAC module a viewer needs `view` on to see this module's insights.
  permission_module   TEXT        NOT NULL,
  -- Tier-1 deterministic detectors run for this module (free, always-on).
  insights_enabled    BOOLEAN     NOT NULL DEFAULT false,
  -- Tier-2 AI narration (paid) for this module's daily briefing.
  narration_enabled   BOOLEAN     NOT NULL DEFAULT false,
  -- How often the tier-2 briefing runs / how eagerly tier-1 alerts fire.
  frequency           TEXT        NOT NULL DEFAULT 'daily'
                      CHECK (frequency IN ('realtime','daily','weekly','off')),
  sort_order          SMALLINT    NOT NULL DEFAULT 100,
  updated_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_ai_insight_modules_updated_at
  BEFORE UPDATE ON shared.ai_insight_modules
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- Seed all 27 candidate modules. insights_enabled = true only for the five
-- that already ship live tier-1 detectors today; the rest are off until their
-- detectors land + the CEO enables them. narration_enabled = false for all
-- (see cost note). Idempotent.
INSERT INTO shared.ai_insight_modules
  (module, display_name, permission_module, insights_enabled, sort_order)
VALUES
  -- Live today (the original 7 categories, folded onto their owning module)
  ('stock',               'Stock & Inventory',        'stock',               true,  10),
  ('invoicing',           'Invoicing & AR',           'invoicing',           true,  20),
  ('intercompany',        'Inter-company',            'intercompany',        true,  30),
  ('approvals',           'Approvals & Workflow',     'org_workflow',        true,  40),
  ('service_jobs',        'Service Jobs',             'service_jobs',        true,  50),
  -- Scaffolded but not yet producing (need detectors)
  ('pricing',             'Pricing & Margins',        'pricing',             false, 60),
  ('hr_attendance',       'Attendance',               'hr_payroll',          false, 70),
  -- New candidates (fan-out waves)
  ('sales',               'Sales & Orders',           'sales',               false, 80),
  ('crm',                 'CRM & Deals',              'crm',                 false, 90),
  ('purchasing',          'Purchasing',               'purchasing',          false, 100),
  ('logistics',           'Logistics & Delivery',     'logistics',           false, 110),
  ('expenses',            'Expenses & Cash',          'expenses',            false, 120),
  ('production',          'Production & Landed Cost', 'production',          false, 130),
  ('retention',           'Retention & Loyalty',      'retention',           false, 140),
  ('accounting',          'Accounting',               'accounting',          false, 150),
  ('retail_partners',     'Retail Partners',          'retail_partners',     false, 160),
  ('stylist_programme',   'Stylist Programme',        'stylist_programme',   false, 170),
  ('sales_campaigns',     'Sales Campaigns',          'sales_campaigns',     false, 180),
  ('marketing',           'Marketing & Ads',          'marketing',           false, 190),
  ('social_media',        'Social & Email',           'social_media',        false, 200),
  ('smartcomm',           'Smart Comm',               'smartcomm',           false, 210),
  ('storefront',          'Storefront',               'storefront',          false, 220),
  ('catalogue',           'Catalogue',                'catalogue',           false, 230),
  ('iam_security',        'Security & Audit',         'iam_security',        false, 240),
  ('tasks',               'Tasks & Calendar',         'tasks',               false, 250),
  ('payroll',             'Payroll & HR',             'hr_payroll',          false, 260),
  ('customer_onboarding', 'Customer Onboarding',      'customer_onboarding', false, 270)
ON CONFLICT (module) DO NOTHING;

-- ============================================================
-- Verify
-- SELECT count(*) FROM shared.ai_insight_modules;                -- 27
-- SELECT module, insights_enabled FROM shared.ai_insight_modules
--   WHERE insights_enabled ORDER BY sort_order;                 -- 5 live
-- ============================================================
