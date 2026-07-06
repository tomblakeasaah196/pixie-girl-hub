-- ============================================================
-- MIGRATION 000264 — Help Center content: CRM & Pipeline
-- Pixie Girl Hub · V2.2 §6.1 (CRM) · §6.30 (Help Center)
--
-- Seeds the full CRM module set: overview, the pipeline & deals,
-- the 360° client profile (preferences, measurements, churn), the
-- Today view, and a FAQ.
--
-- Grounded in src/modules/crm + apps/admin/src/pages/crm: tabs
-- Today / Pipeline / Clients; pipelines+stages, deals (move/status/
-- activities/notes), customer preferences, measurements, churn scores.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('crm', 'CRM & Pipeline',
   'Deals, the sales pipeline, and the 360° customer profile — preferences, measurements and churn risk.',
   'Users', 32)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'crm-overview',
  'What CRM does for you',
  'Track every opportunity through a visual pipeline and keep a rich profile of each customer — so nothing warm goes cold.',
  $md$
## Why CRM exists

Sales records what already sold; **CRM** (sidebar → **CRM**, or `/crm`) tracks
what *might* sell and everyone you sell to. It's where a lead becomes a deal,
moves through stages, and where each customer's history, preferences and risk
of leaving live in one profile.

## The three tabs

- **Today** — your working view: what needs attention now — deals to follow up,
  activities due, warm customers to touch.
- **Pipeline** — the visual board. Deals sit in stages (e.g. New → Contacted →
  Negotiating → Won/Lost); drag a deal along as it progresses.
- **Clients** — the customer directory with the **360° profile**: their
  preferences, measurements, past orders and churn score.

## It's shared, not siloed

CRM reads the same **Contacts** directory the rest of the Hub uses, links to
each customer's **Sales** history, and its warm/at-risk signals feed
**Retention** and **Marketing**. One customer, one record, seen from every
angle.
$md$,
  'all', 'crm',
  ARRAY['crm','overview','pipeline','deals','customers'], 10
FROM shared.help_categories c WHERE c.slug = 'crm'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Pipeline & deals ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'crm-pipeline-and-deals',
  'Working the pipeline and moving deals',
  'Build a pipeline of stages, drop deals into it, and log every call and note so you always know what happened last.',
  $md$
## Pipelines and stages

A **pipeline** is a set of **stages** a deal passes through. You can run more
than one (e.g. a Retail pipeline and a Wholesale pipeline), each with its own
stages, and reorder or rename stages as your process changes.

## Deals

A **deal** is one opportunity — a customer, an expected value, and the stage
it's in. As things progress you:

- **Move** the deal to the next stage (drag on the board, or use the move
  action),
- set its **status** (open / won / lost),
- log **activities** (a call, a visit, a DM exchange) and **notes** so the next
  person — or you next week — knows exactly where it stands.

## Why log activities?

The activity history is what makes the pipeline trustworthy. A deal that's been
silent too long is exactly what **Praxis Insights** flags ("open deal stuck in
the same stage 14+ days") — but that only works if the touches are recorded
here.

## Won and lost

Marking a deal **won** is the natural handoff to **Sales** (turn it into an
order). Marking it **lost** (with a reason) keeps your conversion numbers
honest and feeds what Retention tries to win back.
$md$,
  'all', 'crm',
  ARRAY['crm','pipeline','deals','stages','activities','notes'], 20
FROM shared.help_categories c WHERE c.slug = 'crm'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. The 360° client profile ───────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'crm-customer-profile',
  'The 360° client profile: preferences, measurements & churn',
  'Everything you know about a customer in one place — how they like to be served, their sizes, and how likely they are to leave.',
  $md$
## Opening a profile

On the **Clients** tab, open any customer to see their full profile. It's the
same contact the rest of the Hub uses, enriched with CRM detail.

## Preferences

Record how a customer likes to be served — preferred contact channel, styles,
colours, budget notes. This is what lets staff give a personal service without
relying on memory, and it feeds smarter **Marketing** and **Retention**
targeting.

## Measurements

For made-to-fit and styling work, keep the customer's **measurements** on file
(add, update, remove as they change). Stylists and the Studio pull from here
instead of re-measuring every time.

## Churn score

Each customer can carry a **churn-risk score** (how likely they are to stop
buying). High/Critical scores are your **win-back list** — Praxis Insights
surfaces them, and Retention acts on them. You can review the score history on
the profile.

## One profile, many modules

Because it's the shared contact, a change here shows up wherever that customer
appears — Sales, Invoicing, Messaging, Retention. Update once, correct
everywhere.
$md$,
  'all', 'crm',
  ARRAY['crm','profile','preferences','measurements','churn','360'], 30
FROM shared.help_categories c WHERE c.slug = 'crm'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'crm-faq',
  'CRM FAQ',
  'Deal vs order, why deals get flagged, record scope (all/team/own), and how CRM connects to the rest of the Hub.',
  $md$
## "What's the difference between a deal and an order?"

A **deal** is a *maybe* — an opportunity you're working. An **order** (in
Sales) is a *yes* — a committed sale that touches stock and money. You win a
deal, then it becomes an order.

## "Why did a deal get flagged by Praxis?"

Because it sat in the same stage too long (14+ days, escalating at 30). Move it,
close it, or log an activity — the flag auto-resolves once the deal progresses.

## "Which customers and deals can I see?"

That depends on your **record scope**: *all* (everything), *team* (your team's)
or *own* (only yours). It's set by your role. If a colleague's deal isn't
visible, that's your scope, not a bug.

## "Do I re-enter a customer that's already in Contacts?"

No. CRM uses the shared **Contacts** directory — search for the customer and
they're already there, with their history. Adding a "new" one that already
exists creates a duplicate, so search first.

## "How does CRM help retention?"

Preferences and churn scores from the profile feed **Retention** (win-back,
loyalty) and **Marketing** (targeting), so the effort you put into the profile
pays off as better, more personal outreach.
$md$,
  'all', 'crm',
  ARRAY['crm','faq','deals','scope','contacts','retention'], 40
FROM shared.help_categories c WHERE c.slug = 'crm'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'crm'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
