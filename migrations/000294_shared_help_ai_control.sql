-- ============================================================
-- MIGRATION 000294 — Help Center content: AI Control & Governance
-- Pixie Girl Hub · V2.2 §6.31 (AI Governance) · §6.30 (Help Center) [PR3]
--
-- Grounded in src/modules/ai_governance + apps/admin/src/pages/ai-control:
-- feature flags, grants, vendors & models, budget (active/set) + spend
-- meter/usage, brand voice, action catalogue, and the Insights matrix.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('ai-control', 'AI Control & Governance',
   'The switchboard for all AI — vendors & models, spend & budget, feature flags, the action catalogue and Insights.',
   'ShieldCheck', 74)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'ai-control-overview',
  'What AI Control governs',
  'Everything AI in one place: which vendor and model, how much it may spend, what it''s allowed to do, and which modules it watches.',
  $md$
## What it is

**AI Control** (sidebar → **AI Control**, or `/ai-control`) is the governance
switchboard for every AI feature in the Hub — Praxis, the daily briefing, Insights
narration, brand-voice generation. It answers four questions: *which AI, how much,
what may it do, and where.*

## What lives here

- **Vendors & Models** — which AI provider and model the Hub uses, with their
  per-token costs.
- **Spend & Budget** — the monthly soft cap (warn) and hard cap (stop), plus a
  live spend meter.
- **Feature Flags** — turn individual AI features on or off.
- **Grants** — who is allowed to use which AI capability.
- **Action Catalogue** — the actions Praxis is permitted to take.
- **Brand Voice** — the tone AI writing uses for each business.
- **Insights** — the per-module matrix for what Praxis watches and narrates.

## Why one place

AI can be powerful and, unmanaged, expensive. Centralising the vendor, the budget,
the abilities and the flags means you control cost and capability from one screen —
nothing AI happens outside these guardrails.
$md$,
  'ceo', 'aicontrol',
  ARRAY['ai-control','governance','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'ai-control'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Vendors, models & spend ───────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'ai-control-vendors-and-spend',
  'Vendors, models and controlling spend',
  'Pick the provider and model, set a monthly budget with soft and hard caps, and watch a live meter of exactly where AI money went.',
  $md$
## Vendors & models

**Vendors & Models** is where you set which AI provider and model the Hub uses and
their **per-token costs**. The Hub is vendor-agnostic — you can run without any
vendor at all (AI features fall back to deterministic behaviour), or plug in a
provider and choose the model per capability.

## The budget: soft and hard caps

**Spend & Budget** sets a monthly **soft cap** (you get warned) and **hard cap**
(paid AI pauses gracefully). Every AI call is metered to the usage ledger with its
real token count and cost, so the **spend meter** always shows where the month's
budget went — by feature and by vendor.

## What happens at the hard cap

Paid AI stops *gracefully* — Praxis narration and briefings fall back to
rule-written text, but **no rule-based feature stops** (Insights detection, alerts,
the bell all keep running). When a new month opens or you raise the cap, paid AI
resumes on its own. Enabling AI can never surprise you with a bill.
$md$,
  'ceo', 'aicontrol',
  ARRAY['ai-control','vendors','models','budget','spend','caps'], 20
FROM shared.help_categories c WHERE c.slug = 'ai-control'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Flags, grants, actions & insights ─────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'ai-control-flags-actions-insights',
  'Feature flags, the action catalogue and the Insights matrix',
  'Switch AI features on or off, decide exactly what Praxis may do, choose the brand voice, and pick which modules Praxis watches and narrates.',
  $md$
## Feature flags & grants

**Feature Flags** turn individual AI capabilities on or off (e.g. the AI Daily
Briefing) with a single switch. **Grants** decide **who** may use a given AI
capability — so AI access is deliberate, not blanket.

## The action catalogue

The **Action Catalogue** is the list of actions Praxis is permitted to take. This
is the hard boundary on what the agent can *do* — Praxis can only perform actions
in the catalogue, and even then only within the requesting user's permissions.
Two independent limits: the catalogue and your RBAC.

## Brand voice

**Brand Voice** sets the tone AI writing uses per business, so an AI-drafted
message sounds like Pixie Girl or Faitlynhair — not generic.

## The Insights matrix

**Insights** is the per-module switchboard: for each of the covered modules, turn
**detection** on/off (free, always Tier-1 rules) and **narration** on/off (the
paid AI morning briefing). This is where you decide exactly which modules Praxis
watches and which get AI-written summaries — see the Praxis Insights guides for the
full detail.
$md$,
  'ceo', 'aicontrol',
  ARRAY['ai-control','feature-flags','action-catalogue','brand-voice','insights'], 30
FROM shared.help_categories c WHERE c.slug = 'ai-control'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'ai-control-faq',
  'AI Control FAQ',
  'Running without a vendor, stopping spend, limiting Praxis, where the briefing is toggled, and reading the meter.',
  $md$
## "Can I run the Hub without any AI vendor?"

Yes. AI features fall back to **deterministic** behaviour — Insights detection,
alerts and rule-written briefings all keep working. You can add a vendor later to
enable narration and richer Praxis answers.

## "How do I stop AI spend?"

The **hard cap** in Spend & Budget is the master brake — paid AI pauses when it's
reached. You can also switch off individual **feature flags** or **narration** per
module. Rule-based features stay free and running regardless.

## "How do I limit what Praxis can do?"

Through the **Action Catalogue** (what actions exist) and **grants** (who may use
them) — plus every user's own permissions. Praxis can't exceed any of these.

## "Where do I turn the morning briefing on or off?"

The **AI Daily Briefing** feature flag here, plus per-module **narration** on the
Insights matrix. Off = deterministic (free) briefing; on = AI-narrated within
budget.

## "How do I see what AI cost me?"

The **spend meter** shows the month's spend against both caps, broken down by
feature and vendor, from the metered usage ledger — every call is line-itemised.
$md$,
  'ceo', 'aicontrol',
  ARRAY['ai-control','faq','vendor','caps','praxis','briefing'], 40
FROM shared.help_categories c WHERE c.slug = 'ai-control'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='aicontrol';
-- expected: 4 rows
-- ============================================================
