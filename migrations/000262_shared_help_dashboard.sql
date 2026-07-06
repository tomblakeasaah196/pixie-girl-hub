-- ============================================================
-- MIGRATION 000262 — Help Center content: Dashboard & Reports
-- Pixie Girl Hub · V2.2 §6.30 (Help Center) · §6.24 (Dashboards/Reports)
--
-- Seeds the DB-backed Help Center (shared.help_categories /
-- shared.help_articles, from 000214) with the full Dashboard module set:
-- overview, reading the numbers, the daily Praxis briefing, saved &
-- scheduled reports, and a troubleshooting FAQ.
--
-- Content is grounded in the shipped module (src/modules/dashboards +
-- apps/admin/src/pages/dashboard): domain tabs, All-Businesses view,
-- Reports tab, briefings, saved-reports, report-runs (confirm + PDF).
--
-- Articles are praxis_indexed (default true); the generic mirror in
-- 000274 copies them into ai_knowledge_chunks for Praxis retrieval.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING. Re-runs are no-ops.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('dashboard', 'Dashboard & Reports',
   'Your daily numbers at a glance — KPIs, trends, the morning briefing and confirm-then-file reports.',
   'LayoutDashboard', 15)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'dashboard-overview',
  'What the Dashboard shows you',
  'One screen for the pulse of the business: revenue, orders, cash, and the things that need attention — per business or across both.',
  $md$
## What the Dashboard is for

The **Dashboard** (sidebar → **Dashboard**, or `/dashboard`) is the first
screen you open each day. It answers *"how are we doing right now, and what
needs me?"* without you opening five other modules.

It reads only from data already in the Hub — sales, invoices, stock, jobs —
so the numbers are the same ones the underlying modules show. Nothing here is
typed by hand.

## The tabs across the top

- **Overview** — the headline set: Revenue, Orders, Average Order Value, New
  Customers, Cash Collected, Pending Approvals, Low-stock Alerts, Active
  Deliveries, Overdue Invoices and Open Service Jobs, plus a revenue trend and
  an orders-by-channel breakdown.
- **Domain tabs** (Sales, Operations, Finance, …) — a deeper set of KPIs and
  charts for one area. Each tile can open a **detail drawer** with the rows
  behind the number.
- **All Businesses** — CEO only. Aggregates Pixie Girl and Faitlynhair into
  one combined view. Everyone else sees only their active business.
- **Reports** — the saved and scheduled reports library (see the reports
  article).

## Picking the period

Every figure respects the **period picker** (today, this week, this month, a
custom range). Change it once and the whole dashboard re-reads for that window.

## It follows your entity and your permissions

The dashboard is scoped to the **business chip** at the top — switch entity
and the numbers switch with it. Tiles you don't have permission to see (for
example cost or margin figures) simply don't appear; the API enforces this, so
it is never just a hidden button.
$md$,
  'all', 'dashboard',
  ARRAY['dashboard','overview','kpi','metrics'], 10
FROM shared.help_categories c WHERE c.slug = 'dashboard'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Reading the numbers ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'dashboard-reading-the-numbers',
  'Reading the KPIs and drilling into them',
  'Each tile is a live figure you can click through to the exact records behind it — no exporting to check a number.',
  $md$
## Every tile is clickable

A KPI tile isn't just a number — most open a **detail drawer** listing the
records that make it up. Tap **Overdue Invoices** and you get the actual
overdue invoices; tap **Open Service Jobs** and you get the jobs. From the
drawer you jump straight to the record in its own module.

## What the headline tiles mean

- **Revenue** — value of sales in the chosen period (NGN, from paid + posted
  orders).
- **Orders** / **Avg Order Value** — count and the average basket size.
- **Cash Collected** — money actually received (not just invoiced).
- **Pending Approvals** — items sitting in an approval queue waiting on
  someone (discounts, expenses, adjustments…).
- **Low-stock Alerts / Active Deliveries / Overdue Invoices / Open Service
  Jobs** — the operational counts that usually mean *someone needs to act*.

## The charts

- **Revenue Trend** — the line over the period, so you see momentum, not just
  a total.
- **Orders by Channel / Revenue by Channel** — where the money comes from
  (storefront, walk-in, wholesale, partner…).
- Sales domain adds **Top Products** and **Payment Methods**.

## Numbers vs. Insights

The dashboard tells you *the score*. **Praxis Insights** (the alert bar and
the Insights Center) tells you *what's wrong and to act on it*. They pull from
the same live data — the dashboard is the summary, insights are the exceptions.
$md$,
  'all', 'dashboard',
  ARRAY['dashboard','kpi','drill-down','charts'], 20
FROM shared.help_categories c WHERE c.slug = 'dashboard'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. The daily Praxis briefing ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'dashboard-daily-briefing',
  'The morning briefing on your Dashboard',
  'A short plain-language summary of the day, generated every morning — free by default, AI-narrated only where you opt in.',
  $md$
## What it is

Each morning at **07:00** the Hub writes a **briefing** per business and
delivers it to the Dashboard / Command Center. It reads the summarised counts
(open items, urgent items, overdue invoices, low stock…) and tells you, in a
sentence or two, what changed and what to look at first.

Unread briefings carry a dot; the full history is on the Dashboard.

## Free by default

The briefing is **rule-written and free** unless you switch on AI narration
for a module in **AI Control → Insights**. Even then it only ever reads the
*summarised* numbers, never your raw records, and it is capped by your monthly
AI budget. If narration is off, the budget is spent, or no AI vendor is set up,
you still get the clear rule-written version — the widget is never blank.

## Where it connects

The briefing links back to the specific alerts it mentions, so a line like
*"3 overdue invoices, 1 urgent"* takes you to those invoices. It's the same
finding data as the **Insights Center** — the briefing is just the morning
digest of it.
$md$,
  'all', 'dashboard',
  ARRAY['dashboard','briefing','praxis','morning'], 30
FROM shared.help_categories c WHERE c.slug = 'dashboard'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Reports: saved, confirmed & scheduled ─────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'dashboard-reports',
  'Saved reports, weekly auto-reports and PDFs',
  'The Reports tab: build a view once and save it, let the Hub compile the weekly report for you, and export a clean PDF.',
  $md$
## Saved reports

On the **Reports** tab you can save a dashboard view (its domain, period and
filters) as a **saved report** so you don't rebuild it each time. Open it and
it re-runs live against current data.

## Confirm-then-file weekly reports (§6.30)

Part of the "no manual compilation" promise: the Hub **auto-generates** the
weekly sales and customer reports from logged data into a **review queue**.
Staff **confirm** the pre-filled report rather than retype it. A confirmed
report run can be turned into a **PDF** for the record or for sharing.

- **Confirm** needs the *approve* permission.
- **Generate PDF** needs the *export* permission.

## Scheduled reports

For reports you want on a cadence (e.g. every Monday), the delivery schedule
lives in **Settings → Scheduled Reports**. The Dashboard is where you read and
confirm the runs those schedules produce.

## Exporting

Where a report or KPI drawer supports it, use **Export** to pull a styled
`.xlsx`/PDF. Exports respect your field permissions — hidden columns (cost,
margin) stay hidden in the file too.
$md$,
  'ceo', 'dashboard',
  ARRAY['dashboard','reports','pdf','scheduled','weekly'], 40
FROM shared.help_categories c WHERE c.slug = 'dashboard'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'dashboard-faq',
  'Dashboard FAQ',
  'Why a number looks different from a module, who sees All Businesses, missing tiles, and how fresh the figures are.',
  $md$
## "The dashboard shows a different number than the module."

Almost always a **period or entity** difference. The dashboard defaults to a
period (e.g. this month) and to your active business; the module list you're
comparing to may be showing all-time or the other entity. Match the period and
the business chip and they line up — they read the same tables.

## "Why can't I see the All Businesses tab?"

It's **CEO-only**. Combining both companies into one view is a management-level
capability; staff see only the business they're in.

## "A KPI tile is missing."

Either your role doesn't have permission for that figure (cost/margin tiles are
restricted), or that domain isn't enabled for your business. Missing is by
design, not a fault.

## "How fresh are the numbers?"

Live — they read current data each time the page loads or you change the
period. The one exception is the **morning briefing**, which is generated once
at 07:00 (you can still open the live dashboard any time for up-to-the-minute
figures).

## "Can I get this emailed to me?"

Yes — set up a **Scheduled Report** in Settings. The Hub compiles and delivers
it on your chosen cadence, and the run appears here to confirm.
$md$,
  'all', 'dashboard',
  ARRAY['dashboard','faq','troubleshooting','permissions'], 50
FROM shared.help_categories c WHERE c.slug = 'dashboard'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'dashboard'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
