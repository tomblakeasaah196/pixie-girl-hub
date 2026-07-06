-- ============================================================
-- MIGRATION 000298 — Help Center content: Getting Started
-- Pixie Girl Hub · V2.2 §6.30 (Help Center)  [PR3]
--
-- Populates the existing (previously-empty) 'getting-started' category
-- with first-day orientation: welcome & the shape of the Hub, the two
-- companies & brand switching, permissions & what you can see, and asking
-- for help.
--
-- related_module is left NULL (these are cross-cutting orientation
-- articles, not tied to one module).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

-- The 'getting-started' category already exists (000214). Safe no-op.
INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('getting-started', 'Getting Started',
   'First-day orientation and the shape of the Hub.',
   'Sparkles', 10)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Welcome / the shape of the Hub ────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'welcome-to-the-hub',
  'Welcome to Pixie Girl Hub',
  'One system for two companies — how the Hub is organised, how modules fit together, and where to start on day one.',
  $md$
## What the Hub is

Pixie Girl Hub runs **two companies from one place** — Pixie Girl Global and
Faitlynhair. Everything the business does — selling, stock, money, people,
marketing — lives here as connected **modules**, so information flows instead of
sitting in separate apps and spreadsheets.

## How it's organised

Modules are grouped by what they're for:

- **Run** — day-to-day selling: Dashboard, Sales, CRM, Stylist Studio, Workspace,
  Insights.
- **Operate** — the supply side: Stock, Catalogue, Logistics, Purchasing,
  Production, Retail Partners, Stylists.
- **Finance** — the money: Invoicing, Accounting, Expenses, Pricing, Cash Requests.
- **People** — the team & customers: HR, Payroll, Performance, Contacts, Retention,
  Messaging, Org & Workflow.
- **Grow** — reach: Sales Campaigns, Social, Marketing, Praxis AI.
- **System** — the plumbing: Settings, IAM & Security, Documents, AI Control,
  Storefront Studio, Notifications, Help Center.

## The golden thread

Modules share data. A **sale** draws down **stock**, raises an **invoice**, and can
create a **delivery** — you enter it once. That connectedness is the whole point:
do the work in the right place and the rest follows.

## Start here

Open the **Dashboard** for today's numbers, glance at the **bell** for anything
needing you, and use the **Help Center** (or ask **Praxis**) whenever you're
unsure. Every module has a guide here.
$md$,
  'all', NULL,
  ARRAY['getting-started','welcome','orientation','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'getting-started'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Two companies & switching ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'two-companies-and-switching',
  'Two companies, one Hub: switching between them',
  'Pixie Girl and Faitlynhair share the software but keep their data completely separate — the business chip decides which one you''re working in.',
  $md$
## Separate data, shared software

Pixie Girl Global and Faitlynhair run on the **same Hub** but their data is
**completely separate** — separate stock, sales, books and customers. One never
sees the other's records; only the software is shared.

## The business chip

At the top you'll see the **business chip** — it tells you which company you're
working in, and switching it switches everything: the sales you see, the stock
counts, the dashboard numbers. If a number looks wrong, check you're in the right
business first.

## Who sees both

Most staff work in **one** business. The **CEO** can see both and switch freely,
plus an **All Businesses** view that combines them (on the Dashboard). Genuinely
cross-company things — inter-company transactions, stylist payouts — are handled so
they show correctly on both sides.

## Why it's built this way

Two brands, two sets of customers, two sets of books — but one team and one tool.
Keeping the data isolated protects each business while letting you run both without
buying (or learning) two systems.
$md$,
  'all', NULL,
  ARRAY['getting-started','entities','brand-switching','isolation'], 20
FROM shared.help_categories c WHERE c.slug = 'getting-started'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Permissions & what you can see ────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'what-you-can-see-and-do',
  'What you can see and do (permissions)',
  'The Hub shows you exactly what your role needs — no more. Here''s why a button or a number might not appear for you.',
  $md$
## You see what your role allows

The Hub tailors itself to your **role**. Controls you don't have permission for are
**hidden**, and figures you're not cleared for (like cost or salary) simply don't
show. This isn't things breaking — it's the Hub keeping you focused and sensitive
data protected.

## The layers, briefly

Access is decided on a few layers: which **business**, which **modules**, which
**actions** (view / create / edit / approve…), which **records** (everything, your
team's, or just yours), and which **fields**. So two people on the same screen can
see different things — correctly.

## "Why can't I see / do X?"

Usually one of:

- the **module** isn't enabled for your role,
- you have **view** but not **edit/approve** for that action,
- the record is outside your **scope** (it's someone else's),
- it's a **restricted field** (cost, salary) your role doesn't include.

If you genuinely need access for your job, ask whoever manages the Hub — access is
granted deliberately (and reviewed), which is what keeps the business safe.

## It's enforced, not just hidden

Permissions are enforced on the server, not merely hidden in the screen. That's a
feature: it means the rules actually hold, and every sensitive action is recorded
in the audit log.
$md$,
  'all', NULL,
  ARRAY['getting-started','permissions','rbac','access'], 30
FROM shared.help_categories c WHERE c.slug = 'getting-started'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Getting help ──────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'getting-help',
  'Getting help: the Help Center and Praxis',
  'Two ways to get unstuck — read the guide for any module, or just ask Praxis in plain language.',
  $md$
## When you're stuck

You're never far from an answer:

1. **Help Center** (`/help`) — a full guide for **every** module: what it's for,
   how to do the common tasks, and an FAQ. Browse to your module or search across
   everything.
2. **Praxis** — the floating launcher on any screen, or `/praxis`. Ask in plain
   language ("how do I take a part-payment?", "what needs my attention?") and get
   an answer grounded in these same guides and your live data.

## They agree, because they share a source

Every Help Center article is indexed for Praxis, so the guide you'd read and the
answer Praxis gives come from **one source**. Whichever you prefer, you get the
same, accurate answer.

## Still stuck?

If something isn't covered, tell whoever manages your Hub — help content is
editable in-app, so gaps can be filled quickly (see the "Using the Help Center"
guides).
$md$,
  'all', NULL,
  ARRAY['getting-started','help','praxis','support'], 40
FROM shared.help_categories c WHERE c.slug = 'getting-started'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles c
--   JOIN shared.help_categories cat ON cat.category_id=c.category_id
--   WHERE cat.slug='getting-started';  -- expected: 4 rows
-- ============================================================
