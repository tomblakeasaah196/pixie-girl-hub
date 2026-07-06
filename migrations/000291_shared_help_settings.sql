-- ============================================================
-- MIGRATION 000291 — Help Center content: Settings
-- Pixie Girl Hub · V2.2 §6.25 (Settings) · §6.30 (Help Center)  [PR3]
--
-- Grounded in apps/admin/src/pages/SettingsHome (groups Identity / Money /
-- Operations / Communication) + src/modules/settings + business_setup +
-- platform_settings: business setup, businesses, appearance, login,
-- policies; currencies/FX, tax, gateways, bank accounts; document
-- numbering, custom fields, pipeline stages, scheduled reports, factory
-- languages; document templates, email signatures, notifications, channel
-- policy, quick replies; integration secrets / API keys.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('settings', 'Settings & Configuration',
   'Where the Hub is configured — identity, money, operations, communication and integrations.',
   'Settings', 72)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'settings-overview',
  'What lives in Settings',
  'The control room: business identity, money setup, operational rules and communication — organised into four clear groups.',
  $md$
## What it is

**Settings** (sidebar → **Settings**, or `/settings`) is where the Hub is
configured for how *your* businesses actually run. It's organised into groups so
you can find things fast:

- **Identity** — Business Setup, Businesses, Appearance, Login Screen, Business
  Policies.
- **Money** — Currencies & FX, Tax Rates, Payment Gateways, Bank Accounts.
- **Operations** — Document Numbering, Custom Fields, Pipeline Stages, Scheduled
  Reports, Factory Languages.
- **Communication** — Document Templates, Email Signatures, Notifications,
  Channel Policy, Quick Replies.
- **Integrations** — API keys and integration secrets.

## Set once, used everywhere

Almost everything here is a **source of truth** the rest of the Hub reads: your
currencies drive pricing and accounting, your document numbering names every
invoice and PO, your channel policy governs messaging cost. Change it here, and
every module that depends on it follows.

## Where some things moved

A few adjacent controls live in their own modules: the **audit log** is in **IAM
& Security**, **roles & permissions** are in **Org & Workflow**, and **storefront
policies/templates** are in **Storefront Studio**. Settings links across to them.
$md$,
  'ceo', 'settings',
  ARRAY['settings','configuration','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'settings'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Identity & money ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'settings-identity-and-money',
  'Identity and money setup',
  'Define each business and how it looks, then the money rails — currencies & FX, tax, gateways and bank accounts.',
  $md$
## Identity

- **Business Setup / Businesses** — the companies the Hub runs (Pixie Girl,
  Faitlynhair) and their details.
- **Appearance** — the platform skin and business tint (the two-layer theming).
- **Login Screen** — the DB-driven login configuration (branding, PIN, geo
  welcome).
- **Business Policies** — the operating rules for a business.

## Money

- **Currencies & FX** — the currencies you trade in and the exchange rates that
  restate them; this feeds **Pricing** and **Accounting**.
- **Tax Rates** — the taxes applied to sales and reflected in the books.
- **Payment Gateways** — Paystack / Opay / Nomba / Stripe, so pay links and
  checkouts can collect money.
- **Bank Accounts** — the accounts money is reconciled against in Accounting.

## Why it's foundational

Get the money setup right and everything downstream is correct: pay links work,
invoices carry the right tax, prices gross up for the right currency, and the
books reconcile. It's worth doing carefully once.
$md$,
  'ceo', 'settings',
  ARRAY['settings','identity','currencies','fx','tax','gateways'], 20
FROM shared.help_categories c WHERE c.slug = 'settings'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Operations & communication ────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'settings-operations-and-comms',
  'Operations and communication settings',
  'Numbering, custom fields, pipelines and scheduled reports; plus document templates, email signatures, notifications and the channel policy.',
  $md$
## Operations

- **Document Numbering** — the format and sequence for invoices, POs, quotes and
  the rest. Sequential numbering is what keeps the books and audits clean.
- **Custom Fields** — extra fields you add to records to fit your business.
- **Pipeline Stages** — the CRM pipeline stages deals move through.
- **Scheduled Reports** — reports the Hub compiles and delivers on a cadence
  (read/confirmed on the Dashboard).
- **Factory Languages** — language settings for factory-facing documents.

## Communication

- **Document Templates** — the look of the PDFs you send (invoices, letters).
- **Email Signatures** — the signatures on outbound email.
- **Notifications** — notification configuration.
- **Channel Policy** — the per-event channel + cost guardrails (why transactional
  goes on email and only time-sensitive updates go on paid WhatsApp).
- **Quick Replies** — canned responses for the messaging inbox.

## The channel policy is the cost lever

**Channel Policy** is where the messaging cost discipline lives — it decides which
channel each automated message uses. It's why the Hub is cheap to run: receipts go
by free email, only recovery-positive moments use paid WhatsApp.
$md$,
  'ceo', 'settings',
  ARRAY['settings','numbering','templates','channel-policy','scheduled-reports'], 30
FROM shared.help_categories c WHERE c.slug = 'settings'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'settings-faq',
  'Settings FAQ',
  'Where roles/audit went, adding a currency or gateway, document numbering, custom fields, and who can change settings.',
  $md$
## "Where are roles and the audit log?"

**Roles & permissions** live in **Org & Workflow**; the **audit log** lives in
**IAM & Security**. Settings links to both — they're just managed in the modules
they belong to.

## "How do I add a currency or a payment gateway?"

Currencies and FX are under **Money → Currencies & FX**; gateways under **Money →
Payment Gateways**. Adding them here makes them available to Pricing, Invoicing
and checkout immediately.

## "How do invoice/PO numbers get their format?"

From **Document Numbering**. Set the format and sequence once and every document
is numbered consistently — which the books and any audit rely on.

## "Can I add fields the Hub doesn't have?"

Yes — **Custom Fields** let you add business-specific fields to records without a
code change.

## "Who can change Settings?"

Settings is management-level and permission-gated. Money and identity settings in
particular are restricted, because they're the source of truth the whole Hub
reads.
$md$,
  'ceo', 'settings',
  ARRAY['settings','faq','roles','audit','currency','custom-fields'], 40
FROM shared.help_categories c WHERE c.slug = 'settings'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='settings';
-- expected: 4 rows
-- ============================================================
