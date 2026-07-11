-- ============================================================
-- MIGRATION 000328 — Help Center content: AI Chief of Staff (PR6)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- Seeds Help Center articles for the Chief of Staff surfaces (Goals, Notes,
-- the CoS agent, accountability, and personalisation) under the existing
-- 'workspace' help category (seeded in 000266). Seed-only — no schema change,
-- so EXPECTED_SHARED is unaffected.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cos-overview',
  'Meet your Chief of Staff',
  'A "better Notion" that turns what you say into goals, milestones, tasks and reminders — then follows up so nothing slips.',
  $md$
## What it is

The **AI Chief of Staff** (Workspace → **AI Chief of Staff**) is your personal
execution assistant. Describe what you want to get done in plain language and it
drafts the **whole plan** — a goal, its milestones, the tasks, deadlines and
calendar events — for you to approve in one tap.

It only ever touches your **goals, tasks, calendar, notes and contacts**. It
does not run sales, cash, stock, HR or any other part of the Hub — that's
**Praxis**. If you ask for something outside its remit, it'll point you to
Praxis instead.

## Turning it on

The Chief of Staff is owned entirely from **AI Control → Feature Flags**
(enable "Chief of Staff"). No redeploy, no env switch. While it's off — or over
budget, or no AI vendor is configured — the tab still works and explains what to
switch on.
$md$,
  'all', 'workspace',
  ARRAY['workspace','chief-of-staff','cos','ai','goals'], 50
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Goals & the batch plan ────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cos-goals-and-plans',
  'Goals, milestones and one-tap plans',
  'How goals roll up progress, and how the Chief of Staff proposes a whole plan you approve at once.',
  $md$
## Goals & milestones

A **goal** is a top-level objective with milestones under it. Tasks and calendar
events **link** to a goal (they aren't moved), and the goal's **progress**
rolls up automatically as milestones and linked tasks are completed. A **health**
badge (on track / at risk / behind) is computed for you.

## The one-tap plan

When you describe something to set up, the Chief of Staff proposes the **entire
plan at once** — goal → milestones → tasks → events → notes — as a single card.
Review the steps and **Approve** once; it then creates everything **as you**,
with your permissions. Partly failed? Tap **Retry** to resume the rest. A plan
expires after an hour if you don't act on it.
$md$,
  'all', 'workspace',
  ARRAY['workspace','chief-of-staff','goals','milestones','plan'], 60
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Accountability ────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cos-accountability',
  'Follow-ups & briefings',
  'The Chief of Staff pings you with Done / In Progress / Delayed buttons, asks why, and offers a re-plan — plus a morning goals briefing.',
  $md$
## It follows up

The Chief of Staff watches for risk — no progress, slippage, or something due —
and pings you with **✅ Done / 🟡 In Progress / 🔴 Delayed** buttons. Tap
**Delayed** and it asks *"what caused it?"*, then offers suggestions: move the
deadline, reschedule everything after it, or notify a stakeholder. Accept one
and it does it (through the same approval gate).

## Briefings

Your **morning briefing** carries a goals section — what's behind, at risk, and
today's priorities. An **evening review** sums up the day. On Mondays you also
get an executive review. No new spam: these ride the existing briefing schedule
and respect your quiet hours.
$md$,
  'all', 'workspace',
  ARRAY['workspace','chief-of-staff','followups','briefing','accountability'], 70
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Personalising it ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cos-personalise',
  'Name it, set your hours',
  'Rename your Chief of Staff, pick a tone, set work and quiet hours, and turn win celebrations and adaptive timing on or off.',
  $md$
## Make it yours

Open **Settings** (the gear on the Chief of Staff tab) to:

- **Name it** — call it "Ada" and the tab, chat and every reminder say "Ada".
  (Praxis keeps its own name.)
- Pick a **tone** (warm / concise / formal) and a **pronoun**.
- Set your **work hours**, **quiet hours** (no pings at night), and the times
  for the morning brief and evening review — all in your timezone.
- **Celebrate wins** — a note of congratulations when you finish a milestone or
  hit a goal.
- **Adaptive timing** — it learns when you actually engage and nudges you around
  then, within your work hours.
$md$,
  'all', 'workspace',
  ARRAY['workspace','chief-of-staff','settings','personalise','naming'], 80
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles
--    WHERE slug LIKE 'cos-%' ORDER BY sort_order;   -- expected: 4 rows
-- ============================================================
