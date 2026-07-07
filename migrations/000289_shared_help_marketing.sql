-- ============================================================
-- MIGRATION 000289 — Help Center content: Marketing & Email
-- Pixie Girl Hub · V2.2 §6.15 (Marketing) · §6.30 (Help Center)  [PR3]
--
-- Grounded in src/modules/marketing + email_campaigns + apps/admin/src/
-- pages/marketing: email campaigns (one-off/recurring/triggered/
-- milestone/A-B test; draft→scheduled→sending→sent→completed), segments,
-- newsletters, tracking, attribution, ad-accounts, ad-campaigns (push to
-- Meta).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('marketing', 'Marketing & Email',
   'Email campaigns and newsletters, audience segments, paid ads and attribution.',
   'Mail', 71)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'marketing-overview',
  'What Marketing does',
  'Reach customers at scale the cost-smart way: email campaigns and newsletters (free at volume), paid ads, and attribution to see what worked.',
  $md$
## What it is

**Marketing** (sidebar → **Marketing**, or `/marketing`) is for reaching many
customers at once — email campaigns and newsletters, plus paid ads — and seeing
which effort actually drove sales.

## What you can run

- **Email campaigns** — one-off blasts, recurring sends, triggered messages,
  milestone touches, and A/B tests.
- **Newsletters** — regular email to your list.
- **Ads** — connect **ad accounts** and run **ad campaigns** (pushed to Meta).
- **Attribution** — tie sales back to the campaign that earned them.

## The cost discipline

Email and social reach are **free at volume**, so the Hub routes broad marketing
there by default. WhatsApp marketing is blocked by default precisely because it's
expensive per recipient — a 500-person blast at the marketing rate is real money,
while the same reach by email or an Instagram post is ₦0.

## Where it connects

Marketing targets **segments** from **Contacts**, works with **Retention** (win-
back, loyalty offers) and **Sales Campaigns** (time-bound events), and its
attribution reads **Sales** to prove impact.
$md$,
  'ceo', 'marketing',
  ARRAY['marketing','email','overview','cost'], 10
FROM shared.help_categories c WHERE c.slug = 'marketing'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Email campaigns ───────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'marketing-email-campaigns',
  'Building and sending email campaigns',
  'Pick a campaign type and a segment, build the email, and send now or schedule — with open/click tracking and A/B testing.',
  $md$
## Campaign types

Choose the shape that fits the goal:

- **One-off** — a single send (a launch, an announcement).
- **Recurring** — on a schedule (a weekly newsletter).
- **Triggered** — sent when something happens (a welcome after signup).
- **Milestone** — tied to a customer moment (anniversary, first order).
- **A/B test** — two versions to see which performs, then send the winner.

## The lifecycle

A campaign moves **draft → scheduled → sending → sent → completed**, so you
always know where it is. Build it, target a **segment** (from Contacts), and
either send now or schedule it.

## Tracking

Sends carry **tracking** — opens and clicks — so you learn what subject lines and
offers land. Combined with **attribution**, you can go from "500 opened" to "and
these turned into orders."
$md$,
  'ceo', 'marketing',
  ARRAY['marketing','email','campaigns','segments','ab-test','tracking'], 20
FROM shared.help_categories c WHERE c.slug = 'marketing'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Ads & attribution ─────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'marketing-ads-and-attribution',
  'Paid ads and attribution',
  'Connect ad accounts, run and push campaigns to Meta, and use attribution to know which spend actually earned sales.',
  $md$
## Ad accounts & campaigns

Connect your **ad accounts** and create **ad campaigns** that push to Meta
(Facebook/Instagram). Managing them here keeps ad spend in the same place as the
sales it's meant to drive, rather than in a separate ad manager you forget to
check.

## Attribution

**Attribution** connects a sale back to the marketing that earned it — a
campaign, an ad, a channel. Without it, marketing is a guess; with it, you can
see which spend paid for itself and which didn't.

## What Praxis watches

Insights flags an **active ad campaign that spent over ₦5,000 in 7 days with zero
conversions** (High from ₦50,000) — the classic "money going out, nothing coming
back" signal. It's the guardrail against a runaway ad quietly burning budget.
$md$,
  'ceo', 'marketing',
  ARRAY['marketing','ads','meta','attribution','conversions'], 30
FROM shared.help_categories c WHERE c.slug = 'marketing'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'marketing-faq',
  'Marketing FAQ',
  'Marketing vs Campaigns vs Retention, why WhatsApp marketing is blocked, segments, and the zero-conversion alert.',
  $md$
## "Marketing, Sales Campaigns, Retention — which is which?"

**Marketing** is ongoing reach (email, ads, newsletters). **Sales Campaigns** are
time-bound events (flash sales, landing pages). **Retention** keeps existing
customers (loyalty, win-back). They overlap and feed each other, but that's the
split.

## "Why can't I send a WhatsApp marketing blast?"

Because it's expensive per recipient and the same reach is free by email or
Instagram. It's blocked by default as a cost guardrail; it can be enabled for a
single event from the channel policy if you really need it.

## "Who receives a campaign?"

A **segment** — a defined group of contacts (e.g. "bought in the last 90 days").
Build segments in **Contacts** and target them here.

## "Praxis says an ad has zero conversions."

The campaign spent money over 7 days with no attributed sales. Pause, retarget or
fix the offer — the flag is there so a dud ad doesn't keep spending.

## "How do I know a campaign worked?"

**Tracking** (opens/clicks) plus **attribution** (sales earned). Reach is nice;
attributed revenue is the number that matters.
$md$,
  'ceo', 'marketing',
  ARRAY['marketing','faq','campaigns','whatsapp','segments','attribution'], 40
FROM shared.help_categories c WHERE c.slug = 'marketing'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='marketing';
-- expected: 4 rows
-- ============================================================
