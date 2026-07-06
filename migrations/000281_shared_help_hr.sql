-- ============================================================
-- MIGRATION 000281 — Help Center content: HR & Staff
-- Pixie Girl Hub · V2.2 §6.11 (HR) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full HR & Staff set: overview, the employee directory &
-- dossier, leave & queries, targets & commission/bonus rules, rewards &
-- analytics & settings, and a FAQ. Attendance keeps its own dedicated
-- category (000235); this set cross-links to it rather than duplicating.
--
-- Grounded in src/shared/hr_payroll (hr.routes + hr_ops.routes) and
-- apps/admin/src/pages/hr/HrStaffPage: tabs Overview / Directory / Leave /
-- Attendance / Queries / Targets / Rewards / Analytics / Settings;
-- employees + dossier + contracts, commission/bonus rules, kpi
-- definitions, deductions, leave approve/reject, queries resolve,
-- targets, office geofence & payout-pin settings, onboarding.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('hr', 'HR & Staff',
   'Running the team — directory, leave, queries, targets, commission rules, rewards and settings.',
   'UserCog', 61)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'hr-overview',
  'What HR & Staff manages',
  'The manager''s view of the whole team: who works here, their leave and attendance, their targets and pay rules, and the settings that govern it.',
  $md$
## What it is

**HR & Staff** (sidebar → **HR & Staff**, or `/hr`) is where managers run the
team. Where **My HR** is each person's own view, this is the whole-team view —
the directory, everyone's leave and attendance, their targets and the rules that
turn work into pay.

## The tabs

- **Overview** — the team's HR pulse (counts, pending items).
- **Directory** — every employee and their profile/dossier.
- **Leave** — requests to approve/reject and balances.
- **Attendance** — clock-ins, reconciliation and off-site flags (see the
  dedicated **Attendance** guides).
- **Queries** — formal questions raised with staff, and their resolution.
- **Targets** — the goals set for staff and progress against them.
- **Rewards** — recognition and reward records.
- **Analytics** — the people numbers.
- **Settings** — office geofences, payout PIN, onboarding and HR configuration.

## Where it connects

HR feeds **Payroll** (the rules and inputs that pay people), **Performance** (the
appraisal cycles and KPI definitions), **Contacts** (staff are contacts too), and
**Accounting** (labour cost). It's the people backbone the money modules read.
$md$,
  'ceo', 'hr',
  ARRAY['hr','staff','team','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'hr'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Directory & dossier ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'hr-directory-and-dossier',
  'The employee directory, dossier and contracts',
  'Add and manage staff, open a full dossier per person, and keep their contract on file — the record everything else about them hangs on.',
  $md$
## The directory

The **Directory** lists every employee. Add a new staff member here (they can
then be **invited** to their My HR access and **onboarded**), and open anyone to
see and edit their details.

## The dossier

An employee's **dossier** is the deep record — their profile, contracts,
attendance, targets, queries and pay picture in one place. It's what you open for
a full "everything about this person" view when you need it.

## Contracts

Keep each employee's **contract** on file. Contracts have terms and dates —
Praxis Insights flags a contract **expiring within 30 days** (High within 7) so
renewals aren't missed and nobody works on a lapsed agreement.

## Onboarding

New staff run through an **onboarding** checklist (configured in Settings), so
joining is a tracked process — access, paperwork, first-week steps — not a
scramble.
$md$,
  'ceo', 'hr',
  ARRAY['hr','directory','dossier','contracts','onboarding'], 20
FROM shared.help_categories c WHERE c.slug = 'hr'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Leave, queries & targets ──────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'hr-leave-queries-targets',
  'Approving leave, raising queries and setting targets',
  'Handle the day-to-day of managing people: approve leave, raise and resolve queries, and set the targets that drive commission and appraisal.',
  $md$
## Leave

Staff request leave in My HR; you **approve** or **reject** it on the **Leave**
tab, with balances in view. Approvals here keep coverage honest and feed the
attendance and pay picture.

## Queries

A **query** is a formal question you raise with a staff member (a clarification, a
discrepancy, a follow-up). They **respond** in My HR, and you **resolve** it here
when settled. Open queries are visible so they don't linger.

## Targets

Set **targets** for staff — sales goals, output goals — and track **progress**.
Targets aren't just motivational: they can feed **commission** (in Payroll) and
**appraisal scores** (in Performance), so a hit or missed target flows through to
pay and review automatically.

## Commission, bonus & deduction rules

The **rules** that turn work into money — **commission rules**, **bonus rules**
and **deductions** — are defined on the HR side and applied by **Payroll**. Set
the rule once and every payroll run applies it consistently.
$md$,
  'ceo', 'hr',
  ARRAY['hr','leave','queries','targets','commission','deductions'], 30
FROM shared.help_categories c WHERE c.slug = 'hr'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Rewards, analytics & settings ─────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'hr-rewards-analytics-settings',
  'Rewards, analytics and HR settings',
  'Recognise good work, read the people numbers, and configure the guardrails — office geofences, the payout PIN and onboarding.',
  $md$
## Rewards

The **Rewards** tab records recognition and rewards for staff — a structured way
to acknowledge performance that ties back to the targets and appraisal data,
rather than ad-hoc favours.

## Analytics

**Analytics** turns the team's data into insight — headcount, attendance
patterns, target attainment. It's how a manager spots a trend (absence creeping
up, targets slipping) before it becomes a problem.

## Settings

The **Settings** tab holds the HR guardrails:

- **Office geofences** — the locations that define "on-site" for attendance (the
  basis of off-site flags).
- **Payout PIN** — the PIN control that protects sensitive payout actions.
- **Onboarding** — the checklist new staff run through.

These settings are what make the rest trustworthy — attendance means something
because a geofence defines it, and payouts are protected because a PIN gates them.
$md$,
  'ceo', 'hr',
  ARRAY['hr','rewards','analytics','settings','geofence','payout-pin'], 40
FROM shared.help_categories c WHERE c.slug = 'hr'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'hr-faq',
  'HR & Staff FAQ',
  'HR vs My HR, adding staff, attendance reconciliation, where commission is set, and contract-expiry alerts.',
  $md$
## "HR & Staff or My HR?"

**HR & Staff** is the **manager** view of everyone. **My HR** is each person's own
self-service. If you're running the team, you're here.

## "How do I add a new staff member?"

Add them in the **Directory**, then **invite** them to their My HR access and run
them through **onboarding**. They become an employee record the whole Hub can
reference.

## "Someone missed a clock-in."

Use attendance **reconciliation** (the Attendance tab / dedicated guides) to
correct the record properly, rather than editing it silently. Off-site clock-ins
are flagged for the same reason — the record stays truthful.

## "Where do I set commission or bonuses?"

The **commission**, **bonus** and **deduction rules** live here on the HR side;
**Payroll** applies them each run. Set the rule once; every run uses it.

## "Will I be warned before a contract expires?"

Yes — Praxis flags a contract **expiring within 30 days** (High within 7). Renew
from the employee's dossier before it lapses.
$md$,
  'ceo', 'hr',
  ARRAY['hr','faq','my-hr','attendance','commission','contracts'], 50
FROM shared.help_categories c WHERE c.slug = 'hr'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'hr'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
