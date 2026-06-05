-- ============================================================
-- MIGRATION 000015 — Shared seed data
-- Pixie Girl Hub · JBS Praxis · V2.0
--
-- Seeds:
--   • currencies — the 6 supported display currencies
--   • system roles — owner, admin, manager, staff, viewer, accountant
--   • AI feature flags — one row per advertised AI capability
--   • A default AI budget period for the current month
--
-- This file does NOT seed any business_config rows.
-- Brands (pixiegirl, faitlynhair) are provisioned by
-- scripts/bootstrapBusiness.js which inserts the business_config
-- row, runs the per-business templates, and seeds the tier defaults.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CURRENCIES                                                         ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.currencies (currency_code, display_name, symbol, decimal_places, rounding_unit, is_settlement, is_active, display_order) VALUES
  ('NGN', 'Nigerian Naira',     '₦',  2, 100,     true,  true, 1),
  ('USD', 'US Dollar',           '$',  2, 1,       false, true, 2),
  ('GBP', 'Pound Sterling',      '£',  2, 1,       false, true, 3),
  ('EUR', 'Euro',                '€',  2, 1,       false, true, 4),
  ('CAD', 'Canadian Dollar',     'C$', 2, 1,       false, true, 5),
  ('GHS', 'Ghanaian Cedi',       '₵',  2, 1,       false, true, 6)
ON CONFLICT (currency_code) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ SYSTEM ROLES                                                       ║
-- ║ business = NULL → applicable to any business (system roles).       ║
-- ║ Per-business custom roles are created via Module 6.27.             ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.roles (role_id, role_name, business, is_system, description) VALUES
  ('11111111-1111-1111-1111-000000000001', 'owner',      NULL, true,  'Full system access including settings and brand creation'),
  ('11111111-1111-1111-1111-000000000002', 'admin',      NULL, true,  'Full operational access; cannot create brands or change top-level governance'),
  ('11111111-1111-1111-1111-000000000003', 'manager',    NULL, true,  'Read/write across most modules; approvals required for high-value actions'),
  ('11111111-1111-1111-1111-000000000004', 'staff',      NULL, true,  'Standard operational user'),
  ('11111111-1111-1111-1111-000000000005', 'accountant', NULL, true,  'Read across all modules; full access to accounting and invoicing'),
  ('11111111-1111-1111-1111-000000000006', 'viewer',     NULL, true,  'Read-only access')
ON CONFLICT DO NOTHING;

-- Sample permission seeding for the owner role (full module list)
INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  -- crm
  ('11111111-1111-1111-1111-000000000001', 'crm', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'crm', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'crm', 'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'crm', 'delete', 'all'),
  -- sales
  ('11111111-1111-1111-1111-000000000001', 'sales', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'sales', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'sales', 'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'sales', 'delete', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'sales', 'approve','all'),
  -- pos
  ('11111111-1111-1111-1111-000000000001', 'pos', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'pos', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'pos', 'edit',   'all'),
  -- storefront
  ('11111111-1111-1111-1111-000000000001', 'storefront', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'storefront', 'edit',   'all'),
  -- invoicing
  ('11111111-1111-1111-1111-000000000001', 'invoicing', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'invoicing', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'invoicing', 'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'invoicing', 'delete', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'invoicing', 'approve','all'),
  -- accounting
  ('11111111-1111-1111-1111-000000000001', 'accounting', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'accounting', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'accounting', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'accounting', 'approve', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'accounting', 'export',  'all'),
  -- stock
  ('11111111-1111-1111-1111-000000000001', 'stock', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'stock', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'stock', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'stock', 'delete',  'all'),
  -- catalogue
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'delete', 'all'),
  -- purchasing
  ('11111111-1111-1111-1111-000000000001', 'purchasing', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'purchasing', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'purchasing', 'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'purchasing', 'approve','all'),
  -- production
  ('11111111-1111-1111-1111-000000000001', 'production', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'production', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'production', 'edit',   'all'),
  -- pricing
  ('11111111-1111-1111-1111-000000000001', 'pricing', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'pricing', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'pricing', 'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'pricing', 'approve','all'),
  -- expenses
  ('11111111-1111-1111-1111-000000000001', 'expenses', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'expenses', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'expenses', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'expenses', 'approve', 'all'),
  -- payroll
  ('11111111-1111-1111-1111-000000000001', 'payroll', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'payroll', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'payroll', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'payroll', 'approve', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'payroll', 'export',  'all'),
  -- logistics
  ('11111111-1111-1111-1111-000000000001', 'logistics', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'logistics', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'logistics', 'edit',   'all'),
  -- retail_partners
  ('11111111-1111-1111-1111-000000000001', 'retail_partners', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'retail_partners', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'retail_partners', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'retail_partners', 'approve', 'all'),
  -- stylists (6.26)
  ('11111111-1111-1111-1111-000000000001', 'stylists', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'stylists', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'stylists', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'stylists', 'approve', 'all'),
  -- retention (loyalty, referrals, coupons, subscriptions)
  ('11111111-1111-1111-1111-000000000001', 'retention', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'retention', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'retention', 'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'retention', 'delete', 'all'),
  -- intercompany
  ('11111111-1111-1111-1111-000000000001', 'intercompany', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'intercompany', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'intercompany', 'approve', 'all'),
  -- messaging (Smartcomm)
  ('11111111-1111-1111-1111-000000000001', 'messaging', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'messaging', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'messaging', 'edit',   'all'),
  -- social
  ('11111111-1111-1111-1111-000000000001', 'social', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'social', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'social', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'social', 'approve', 'all'),
  -- campaigns (email)
  ('11111111-1111-1111-1111-000000000001', 'campaigns', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'campaigns', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'campaigns', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'campaigns', 'approve', 'all'),
  -- sales_campaigns (flash sales + landing pages)
  ('11111111-1111-1111-1111-000000000001', 'sales_campaigns', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'sales_campaigns', 'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'sales_campaigns', 'edit',   'all'),
  -- ad_analytics
  ('11111111-1111-1111-1111-000000000001', 'ad_analytics', 'view',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'ad_analytics', 'edit',  'all'),
  -- calendar, tasks, dashboards, reports, documents
  ('11111111-1111-1111-1111-000000000001', 'calendar',    'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'calendar',    'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'calendar',    'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'tasks',       'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'tasks',       'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'tasks',       'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'dashboards',  'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'reports',     'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'reports',     'export', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'documents',   'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'documents',   'create', 'all'),
  -- staff, clock-in, settings, workflow, storefront_studio
  ('11111111-1111-1111-1111-000000000001', 'staff',              'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'staff',              'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'staff',              'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'clock_in',           'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'clock_in',           'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'settings',           'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'settings',           'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'workflow',           'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'workflow',           'edit',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'workflow',           'approve','all'),
  ('11111111-1111-1111-1111-000000000001', 'storefront_studio',  'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'storefront_studio',  'edit',   'all'),
  -- AI modules
  ('11111111-1111-1111-1111-000000000001', 'ai_agent',      'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'ai_agent',      'create', 'all'),
  ('11111111-1111-1111-1111-000000000001', 'ai_insights',   'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'ai_governance', 'view',   'all'),
  ('11111111-1111-1111-1111-000000000001', 'ai_governance', 'edit',   'all')
ON CONFLICT DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AI FEATURE FLAGS — one row per advertised capability               ║
-- ║ All start ENABLED so the system is functional out of the box;      ║
-- ║ the CEO can disable any of these from the AI Control screen.       ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.ai_feature_flags (feature_key, display_name, description, is_enabled, default_provider, default_model, est_cost_per_call_ngn) VALUES
  ('praxis_chat',                  'Praxis Chat (text)',           'Conversational AI assistant — text input.',                                  true,  'deepseek',     'deepseek-chat',          0.20),
  ('praxis_voice',                 'Praxis Voice',                  'Voice input via Groq Whisper API transcription.',                             true,  'groq',         'whisper-large-v3',       0.05),
  ('praxis_drafting',              'Praxis Drafting',               'Drafts invoice notes, customer replies, campaign copy.',                      true,  'deepseek',     'deepseek-chat',          0.30),
  ('praxis_web_prefill',           'Praxis Web/Instagram Pre-fill', 'Pre-fills contact records from a pasted website or Instagram handle.',        true,  'deepseek',     'deepseek-chat',          0.50),
  ('insights_briefing',            'AI Daily Briefing',             'Tier-2 AI narration over tier-1 insights (scheduled).',                       true,  'deepseek',     'deepseek-chat',          1.50),
  ('insights_briefing_realtime',   'AI Real-Time Briefings',        'Real-time briefing generation when an urgent tier-1 insight fires.',          false, 'deepseek',     'deepseek-chat',          1.50),
  ('insights_weekly_report',       'AI Weekly Report Auto-gen',     'Auto-generates the documented Saturday weekly reports (Sales, Customer) from logged data — replaces the Zoho/Sheet ritual.', true, 'deepseek', 'deepseek-chat', 2.00),
  ('insights_stock',               'Stock Insights (deterministic)','Stock below reorder, projected run-out (no AI cost).',                        true,  'rules',        'sql',                    0.00),
  ('insights_margin',              'Margin Insights (deterministic)','Margin below floor, cost spikes (no AI cost).',                              true,  'rules',        'sql',                    0.00),
  ('insights_invoice',             'Invoice Insights (deterministic)','Overdue invoices, cash position warnings (no AI cost).',                    true,  'rules',        'sql',                    0.00),
  ('insights_intercompany',        'Intercompany Insights (deterministic)','Unmatched IC transactions and amount/currency disagreements (no AI cost).', true,  'rules',        'sql',                0.00),
  ('insights_attendance',          'Attendance Insights (deterministic)','Off-site clock-ins, missed shifts (no AI cost).',                       true,  'rules',        'sql',                    0.00),
  ('insights_approval',            'Approval Queue Insights (deterministic)','Approvals piling up, SLA breaches (no AI cost).',                    true,  'rules',        'sql',                    0.00),
  ('insights_service_match',       'Service-Sale Match (deterministic)','Flags Faitlyn service jobs with no matching recorded sale/payment — anti-"pocketing" control (no AI cost).', true, 'rules', 'sql', 0.00),
  ('embeddings',                   'Embeddings (RAG)',              'OpenAI text-embedding-3-small calls during ingestion and queries.',           true,  'openai',       'text-embedding-3-small', 0.02)
ON CONFLICT (feature_key) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AI VENDOR CREDENTIALS — placeholders for the 3 launch vendors     ║
-- ║ Real api_key_enc values populated by the CEO via Business Setup    ║
-- ║ (stored AES-256 encrypted at the app layer, never in plaintext).   ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.ai_vendor_credentials
  (vendor, display_name, default_model, cost_per_1k_input_tokens, cost_per_1k_output_tokens,
   cost_per_audio_minute, cost_native_currency, is_active) VALUES
  ('deepseek', 'DeepSeek API',     'deepseek-chat',            0.00027, 0.00110, 0.0,    'USD', true),
  ('groq',     'Groq Whisper API', 'whisper-large-v3',         0.0,     0.0,     0.00111,'USD', true),
  ('openai',   'OpenAI Embeddings','text-embedding-3-small',   0.00002, 0.0,     0.0,    'USD', true)
ON CONFLICT (vendor) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AI BUDGET — bootstrap the current month                            ║
-- ║ Per the V2 product description: ~US$50/month target for CEO.       ║
-- ║ Using an indicative NGN figure of 75,000 (soft) / 80,000 (hard).   ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.ai_budget_periods
  (period_start, period_end, soft_cap_ngn, hard_cap_ngn, is_active)
VALUES
  (date_trunc('month', CURRENT_DATE)::DATE,
   (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE,
   75000.00, 80000.00, true)
ON CONFLICT DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ TIMELINE EVENT CODES — canonical dictionary (Amendment-8)         ║
-- ║ Prevents inconsistent stage naming on the customer tracking page. ║
-- ║ Admin-extensible via Storefront Studio → Order Timeline settings. ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.timeline_event_codes
  (code, default_label, applies_to_order_types, stage_group, default_customer_visible, display_order, is_system_code) VALUES
  -- Ordered group
  ('order_placed',         'Order Placed',           '{physical,custom,service,subscription}', 'ordered',    true,  10, true),
  ('payment_received',     'Payment Received',       '{physical,custom,service,subscription}', 'ordered',    true,  20, true),
  ('order_confirmed',      'Order Confirmed',        '{physical,custom,service,subscription}', 'ordered',    true,  30, true),
  -- Production group (PXG custom wigs)
  ('weaving_started',      'Weaving in Progress',    '{custom}',                                'production', true,  40, true),
  ('quality_check',        'Quality Check',          '{custom}',                                'production', true,  50, true),
  ('ready_to_ship',        'Ready to Ship',          '{custom}',                                'production', true,  60, true),
  ('left_china',           'Left China',             '{custom}',                                'production', true,  70, true),
  ('in_transit',           'In Transit',             '{physical,custom}',                       'production', true,  80, true),
  ('arrived_lagos',        'Arrived in Lagos',       '{custom}',                                'production', true,  90, true),
  -- Styling (Flow-1 PXG → FLH)
  ('with_stylist',         'With Stylist',           '{custom}',                                'production', true, 100, true),
  ('styling_complete',     'Styling Complete',       '{custom}',                                'production', true, 110, true),
  -- Shipped group
  ('packed_for_dispatch',  'Packed for Dispatch',    '{physical,custom}',                       'shipped',    true, 120, true),
  ('out_for_delivery',     'Out for Delivery',       '{physical,custom}',                       'shipped',    true, 130, true),
  -- Delivered group
  ('delivered',            'Delivered',              '{physical,custom}',                       'delivered',  true, 140, true),
  ('delivery_attempted',   'Delivery Attempted',     '{physical,custom}',                       'shipped',    true, 135, true),
  -- Service group (FLH)
  ('booked',               'Service Booked',         '{service}',                                'service',    true, 200, true),
  ('consultation',         'Consultation',           '{service}',                                'service',    true, 210, true),
  ('in_progress',          'In Progress',            '{service}',                                'service',    true, 220, true),
  ('service_completed',    'Service Completed',      '{service}',                                'service',    true, 230, true),
  -- Terminal states
  ('delayed',              'Delayed',                '{physical,custom,service}',                'terminal',   true, 900, true),
  ('cancelled',            'Cancelled',              '{physical,custom,service,subscription}',   'terminal',   true, 910, true),
  ('refunded',             'Refunded',               '{physical,custom,service,subscription}',   'terminal',   true, 920, true),
  ('returned',             'Returned',               '{physical,custom}',                        'terminal',   true, 930, true)
ON CONFLICT (code) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CANONICAL PERMISSION MODULE KEYS — Amendment-3                    ║
-- ║ Reference table so the admin permission matrix UI has a canonical ║
-- ║ list of grantable modules. Avoids typos like 'org_buider' from    ║
-- ║ silently bypassing access control. Admin can add custom modules.  ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.permission_module_keys (
  module_key            TEXT        PRIMARY KEY,
  display_name          TEXT        NOT NULL,
  description           TEXT,
  is_system_module      BOOLEAN     NOT NULL DEFAULT true,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO shared.permission_module_keys (module_key, display_name, description, display_order) VALUES
  ('crm',                   'CRM',                            'Customer relationships, deals, activities',                   10),
  ('sales',                 'Sales & Quotations',             'Sales orders, quotations, cancellations',                     20),
  ('pos',                   'Point of Sale',                  'POS terminals, sessions, transactions',                       30),
  ('storefront',            'E-Commerce Storefront',          'Public storefront, channel sync, tracking',                   40),
  ('invoicing',             'Invoicing & Billing',            'Invoices, credit notes, receipts, reminders',                 50),
  ('accounting',            'Accounting & Finance',           'COA, journals, bank rec, fiscal periods, tax filings',        60),
  ('expenses',              'Expenses',                       'Reimbursements, cash advances',                                70),
  ('purchasing',            'Purchasing & Procurement',       'Suppliers, RFQs, POs, GRNs, supplier invoices',               80),
  ('stock',                 'Stock Management',               'Stock SSOT, movements, adjustments, transfers, alerts',        90),
  ('logistics',             'Logistics & Delivery',           'Couriers, deliveries, attempts, proofs, POD',                100),
  ('hr_payroll',            'HR & Payroll',                   'Staff, contracts, leave, performance, payroll',              110),
  ('attendance',            'Attendance & Clock-In',          'Geofences, clock events, attendance reports',                120),
  ('contacts',              'Contacts',                       'Cross-brand contact directory',                              130),
  ('documents',             'Documents',                      'Document library, uploads, versioning',                      140),
  ('social',                'Social Media',                   'Social accounts, posts, metrics',                            150),
  ('ad_analytics',          'Ad Analytics',                   'Google/Meta ad campaigns and spend',                          160),
  ('email_campaigns',       'Email Campaigns',                'Email templates, campaigns, A/B variants',                   170),
  ('smartcomm',             'Smartcomm Messaging',            'Unified inbox: WhatsApp, IG DM, email, SMS',                 180),
  ('calendar',              'Calendar & Scheduling',          'Events, participants, resources',                            190),
  ('tasks',                 'Tasks & To-Do',                  'Tasks, subtasks, assignments',                               200),
  ('dashboards',            'Dashboards & Reports',           'Configurable dashboards, saved reports, scheduled reports',  210),
  ('business_setup',        'Business Setup',                 'Brand profile, identity, loyalty config, cancellation policy', 220),
  ('sales_campaigns',       'Sales Campaigns',                'Flash sales, landing pages, signups',                        230),
  ('retention',             'Retention & Loyalty',            'Loyalty tiers, coupons, subscriptions, bundles, workflows',  240),
  ('production',            'Production & Landed Cost',       'Production runs, cost components, landed cost',              250),
  ('service_jobs',          'Service Job Tracker',            'Faitlyn service jobs, chemical recipes, reconciliations',    260),
  ('pricing',               'Pricing Engine',                 'Pricing rules, floors, scenarios, proposals, history',       270),
  ('stylist_programme',     'Stylist Partner Programme',      'Stylist directory, assignments, payouts, certifications',    280),
  ('org_workflow',          'Org & Workflow Builder',         'Org chart, positions, approval workflows, RBAC',             290),
  ('storefront_studio',     'Storefront Studio',              'Themes, pages, navigation, content posts',                   300),
  ('intercompany',          'Inter-Company',                  'Inter-company transactions and reconciliations',             310),
  ('praxis_ai',             'Praxis AI Agent',                'Praxis chat, voice, pending actions',                        320),
  ('ai_insights',           'AI Insights & Briefings',        'Tier-1 insights, briefings, weekly reports',                 330),
  ('ai_governance',         'AI Control & Governance',        'Feature flags, vendor credentials, access grants, budgets',  340),
  ('retail_partners',       'Retail Partners',                'Wholesale partners, consignment, settlements',               350),
  ('audit',                 'Audit Log',                      'Read access to system audit log',                            360)
ON CONFLICT (module_key) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ STYLIST TIER NAMES — V2.2 §6.26 canonical dictionary (Amendment   ║
-- ║ A-2). Free-text current_tier_key in stylist_partners now backed   ║
-- ║ by this admin-extensible dictionary. Drives the certification    ║
-- ║ UI dropdown and the storefront badge text.                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.stylist_tier_keys (
  tier_key              TEXT        PRIMARY KEY,
  display_name          TEXT        NOT NULL,
  description           TEXT,
  display_order         SMALLINT    NOT NULL,
  -- Minimum criteria (informational; actual enforcement is in workflow rules)
  min_completed_jobs    INTEGER,
  min_avg_rating        NUMERIC(3,2),
  min_certifications    INTEGER,
  -- Storefront treatment
  badge_image_url       TEXT,
  storefront_visible    BOOLEAN     NOT NULL DEFAULT true,
  -- Lifecycle
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  is_system_tier        BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO shared.stylist_tier_keys
  (tier_key, display_name, description, display_order, min_completed_jobs, min_avg_rating, min_certifications, storefront_visible, is_system_tier) VALUES
  ('certified', 'Certified', 'Foundational tier — passed the Pixie Girl onboarding programme',              1, 0,   NULL,  1, true, true),
  ('pro',       'Pro',       'Mid tier — proven repeat-client history with consistent quality ratings',     2, 25,  4.20, 2, true, true),
  ('elite',     'Elite',     'Top tier — highest performance, eligible for VIP customer assignments',       3, 100, 4.60, 3, true, true)
ON CONFLICT (tier_key) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ NOTE on per-brand defaults                                         ║
-- ║ Loyalty tiers, document numbering sequences, custom field defs,    ║
-- ║ chart of accounts, pipeline stages, etc. are seeded by the         ║
-- ║ scripts/bootstrapBusiness.js utility when a brand is provisioned.  ║
-- ╚════════════════════════════════════════════════════════════════════╝
