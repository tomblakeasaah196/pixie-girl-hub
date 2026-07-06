-- ============================================================
-- MIGRATION 000283 — Help Center content: Performance & Appraisals
-- Pixie Girl Hub · V2.2 §6.11 (Appraisals) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Performance set: overview, appraisal cycles & reviews,
-- KPI definitions & auto-scoring, calibration, and a FAQ.
--
-- Grounded in src/shared/hr_payroll (performance-cycles, performance-
-- reviews, kpi-definitions), apps/admin/src/pages/hr/PerformancePage
-- (tabs Cycles / Reviews), and 000261 appraisal auto-scoring (score
-- sources: manual, customer_ratings, sales_data, crm_data,
-- service_job_ratings, clock_in_data, custom; calibration).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('performance', 'Performance & Appraisals',
   'Appraisal cycles, reviews, KPI definitions and auto-scoring from real work data.',
   'Gauge', 63)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'performance-overview',
  'What Performance does',
  'Fair, evidence-based appraisals: cycles set the period, KPIs define what''s measured, and much of the score comes straight from real work data.',
  $md$
## What it is

**Performance** (sidebar → **Performance**, or `/performance`) runs staff
appraisals — but grounded in real data, not just opinion. A **cycle** sets the
period, **KPI definitions** set what's measured, and a **review** scores each
person, with many scores **auto-populated** from what actually happened.

## The tabs

- **Cycles** — the appraisal periods you run.
- **Reviews** — the individual appraisals within a cycle.

## Why data-driven

Appraisals lose trust when they're one manager's memory. Here, KPIs like sales,
attendance, service-job quality and customer ratings are **scored from the
system's own records** — so the review starts from evidence, and the manager
adds judgement on top rather than inventing the whole thing.

## Where it connects

Performance reads from **HR** (KPI definitions, targets), **Sales/CRM** (results),
**Service Jobs** (quality) and **Attendance** — the same data that runs the
business also grades how well it was run.
$md$,
  'ceo', 'performance',
  ARRAY['performance','appraisal','overview','kpi'], 10
FROM shared.help_categories c WHERE c.slug = 'performance'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Cycles & reviews ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'performance-cycles-and-reviews',
  'Running an appraisal cycle',
  'Open a cycle for the period, and each person gets a review scored against the KPIs — part automatic, part manager judgement.',
  $md$
## Cycles

A **cycle** is an appraisal period (a quarter, a half-year). Opening a cycle sets
up the **reviews** for the staff it covers, against the KPI definitions in play
for that period.

## Reviews

Each **review** scores one person across the KPIs. For each KPI the review shows a
score and where it came from — **auto** (from data), **manual** (a manager's
input), or **calibrated** (adjusted for fairness across the team). The manager
completes the review, adding commentary and any manual scores.

## Auto vs manual

Where a KPI can be measured from the system (sales, attendance, ratings), the
score is filled in **automatically** and labelled *Auto*. Where it needs
judgement (attitude, teamwork), the manager scores it **manually**. You get the
best of both — hard numbers where they exist, human judgement where they don't.
$md$,
  'ceo', 'performance',
  ARRAY['performance','cycles','reviews','auto','manual'], 20
FROM shared.help_categories c WHERE c.slug = 'performance'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. KPIs, auto-scoring & calibration ──────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'performance-kpis-and-autoscore',
  'KPI definitions, auto-scoring and calibration',
  'Define what''s measured, let the Hub score it from real data, and calibrate across the team so scores are comparable and fair.',
  $md$
## KPI definitions

A **KPI definition** describes a thing you measure — a sales target, punctuality,
service quality — and how it's scored. Definitions are what a review scores
against, so getting them right is what makes appraisals meaningful.

## Auto-scoring from real data

Many KPIs score themselves from the system's records. The score **sources**
include:

- **sales data** — targets and results,
- **customer ratings** and **CRM data** — how customers rated the person,
- **service-job ratings** — quality of styling work,
- **clock-in data** — attendance and punctuality,
- **manual** / **custom** — where a human or a bespoke rule decides.

Each auto-score carries its **evidence**, so a number can be traced back to what
produced it — no black box.

## Calibration

**Calibration** adjusts scores across the team so they're comparable — countering
the "one manager marks hard, another marks soft" problem. A calibrated score is
labelled as such, so everyone knows it was normalised for fairness rather than
raw.

## Why this matters

Pay, promotion and morale hang on appraisals. Auto-scoring makes them evidence-
based, calibration makes them fair, and the labels (*Auto / Manual / Calibrated*)
make them transparent — you can always see how a score was reached.
$md$,
  'ceo', 'performance',
  ARRAY['performance','kpi','auto-score','calibration','evidence'], 30
FROM shared.help_categories c WHERE c.slug = 'performance'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'performance-faq',
  'Performance FAQ',
  'Where auto-scores come from, overriding them, calibration, KPI setup, and the tie to pay.',
  $md$
## "Where does an auto-score come from?"

From the system's own data for that KPI — sales, attendance, customer/service
ratings, CRM. Each auto-score keeps its **evidence**, so you can see exactly what
produced the number.

## "Can I override an auto-score?"

Yes — a manager can enter a **manual** score where judgement is needed or the data
doesn't tell the whole story. The review shows which scores are Auto, Manual or
Calibrated.

## "What is calibration?"

An adjustment so scores are **comparable across the team** — it corrects for
managers who mark harder or softer, so an "8" means the same thing for everyone.

## "How do I decide what's measured?"

Through **KPI definitions** — set what matters and how it's scored, and cycles use
them. Good definitions are what make the appraisal fair and relevant.

## "Does an appraisal affect pay?"

It can — appraisal outcomes inform decisions on bonuses, commission structure and
progression handled in **HR/Payroll**. Because scores are evidence-based and
calibrated, those decisions rest on something defensible.
$md$,
  'ceo', 'performance',
  ARRAY['performance','faq','auto-score','calibration','kpi','pay'], 40
FROM shared.help_categories c WHERE c.slug = 'performance'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'performance'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
