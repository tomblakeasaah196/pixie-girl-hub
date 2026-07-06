-- ============================================================
-- MIGRATION 000280 — Help Center content: My HR (self-service)
-- Pixie Girl Hub · V2.2 §6.11 (HR self-service) · §6.30 (Help Center) [PR2]
--
-- Seeds the full My HR set: overview, clocking & my day, leave &
-- queries, my earnings & targets, and a FAQ.
--
-- Grounded in src/shared/hr_payroll/hr_ops.routes (me, me/today,
-- me/clock, me/leave, me/queries/:id/respond, me/onboarding) and
-- apps/admin/src/pages/hr/MyHrPage.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('my-hr', 'My HR (Self-Service)',
   'Your own corner of HR — clock in, request leave, answer queries, and see your earnings and targets.',
   'Contact', 60)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'my-hr-overview',
  'What My HR shows you',
  'Everything about you as an employee in one place: today''s clock, your leave, any queries to answer, and your earnings and targets.',
  $md$
## What it is

**My HR** (sidebar → **My HR**, or `/my-hr`) is your personal, self-service view
of HR. Where **HR & Staff** is for managers to run the team, My HR is for *you* —
your attendance, your leave, your pay and your targets, without asking anyone.

## What you'll find

- **My Day / clock** — clock in and out, and see today at a glance.
- **Leave** — your balance and requests.
- **Queries** — anything HR has asked you to respond to.
- **Earnings** — your pay, commission and bonus picture.
- **Targets** — the goals set for you and how you're tracking.
- **Onboarding** — your onboarding checklist, if you're new.

## Why self-service

It saves you (and HR) the back-and-forth: you clock, request and check for
yourself, and managers see it on their side automatically. Everything here is
**yours only** — scoped to you.
$md$,
  'staff', 'my-hr',
  ARRAY['my-hr','self-service','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'my-hr'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Clocking & leave ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'my-hr-clocking-and-leave',
  'Clocking in and requesting leave',
  'Clock in and out from My Day, and request leave that your manager approves — with your balance always visible.',
  $md$
## Clocking in and out

From **My Day**, **clock in** when you start and **clock out** when you finish.
Your clock feeds attendance and, where pay depends on it, your earnings. If your
office uses geofences, clocking in from outside the office is recorded as
**off-site** (see the Attendance guides) — so clock from where you actually are.

## Requesting leave

Request **leave** with the dates and type; it goes to your manager to **approve**
or **reject**. Your **balance** is shown so you know what you have before you ask,
and the request's status tells you where it stands — no need to chase.

## Why it's tracked

Your clock and leave aren't just admin — they can affect pay and they keep the
team's coverage honest. Doing them here means the record is accurate and you're
credited correctly.
$md$,
  'staff', 'my-hr',
  ARRAY['my-hr','clock','attendance','leave'], 20
FROM shared.help_categories c WHERE c.slug = 'my-hr'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Earnings, targets & queries ───────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'my-hr-earnings-and-targets',
  'Your earnings, targets and queries',
  'See how your pay, commission and bonuses build up, track your targets, and respond to any queries HR raises with you.',
  $md$
## Earnings

Your **earnings** view shows how your pay is made up — base, **commission** on
sales you drove, and any **bonuses**. Because these compute from real data
(sales, targets, attendance), you can see *why* a number is what it is, not just
the total.

## Targets

**Targets** are the goals set for you (e.g. sales this month). My HR shows each
target and your **progress**, so you always know where you stand against them —
and, since targets can feed commission and appraisal, why they matter.

## Queries

A **query** is a question HR has formally raised with you (a clarification, a
follow-up). **Respond** to it here; your answer is recorded against it. Open
queries are the kind of thing that shouldn't sit — clear them so nothing stalls.
$md$,
  'staff', 'my-hr',
  ARRAY['my-hr','earnings','commission','targets','queries'], 30
FROM shared.help_categories c WHERE c.slug = 'my-hr'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'my-hr-faq',
  'My HR FAQ',
  'My HR vs HR & Staff, forgetting to clock, who sees my data, leave balance, and commission timing.',
  $md$
## "My HR or HR & Staff — which is mine?"

**My HR** is *yours* — your clock, leave, pay and targets. **HR & Staff** is the
manager view of the whole team. You use My HR; managers use HR & Staff.

## "I forgot to clock in."

Tell your manager — attendance can be **reconciled** on the HR side. Off-site or
missed clock-ins are handled through reconciliation rather than silently, so
raise it rather than leaving a gap.

## "Who can see my earnings?"

Your earnings are **yours** in My HR. Managers and payroll see what their role
allows for running pay, but sensitive figures follow the same field-level
permissions as everywhere in the Hub.

## "How do I know my leave balance?"

It's shown on the **Leave** section before you request, so you never over-request
by accident.

## "When does my commission show up?"

Commission builds from the sales you drove and is confirmed through payroll. Your
**earnings** view reflects it as it accrues and is approved — so you can see it
coming, not just on payday.
$md$,
  'staff', 'my-hr',
  ARRAY['my-hr','faq','clock','earnings','leave','commission'], 40
FROM shared.help_categories c WHERE c.slug = 'my-hr'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'my-hr'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
