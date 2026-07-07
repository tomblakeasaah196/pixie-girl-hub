-- ============================================================
-- MIGRATION 000273 — Help Center content: Stylist Partner Programme
-- Pixie Girl Hub · V2.2 §6.12 (Stylist Programme) · §6.30 (Help Center)
--
-- Seeds the full Stylist Programme set: overview, applications &
-- onboarding, tiers/badges & contracts, lead routing & assignments,
-- payouts & referrals, and a FAQ.
--
-- Grounded in src/modules/stylist_programme + apps/admin/src/pages/
-- stylists: applications review, programme/tier/question config,
-- routing suggest, assignments, payouts (submit→approve→pay),
-- partner badge/invite/contract, specialities & certifications.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('stylists', 'Stylist Partner Programme',
   'Independent stylist partners — applications, tiers & badges, lead routing, assignments and payouts.',
   'Contact', 43)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stylists-overview',
  'What the Stylist Programme is',
  'A network of independent stylist partners you recruit, route leads to, and pay out — distinct from your in-house Stylist Studio.',
  $md$
## What it is

The **Stylist Partner Programme** (sidebar → **Stylists**, or `/stylists`) runs
your network of **independent** stylists — partners outside your own staff who
you recruit, route customers to, and pay commissions or payouts to.

## Not the same as Stylist Studio

- **Stylist Studio** = your **in-house** styling floor (your own staff doing
  jobs).
- **Stylist Programme** = **external** partners (independent stylists) you route
  leads to and settle with.

Different people, different money flow.

## The shape of the programme

- **Applications** — stylists apply; you review and approve them in.
- **Tiers & badges** — partners are graded (a tier) and can carry a **badge**
  that signals their standing.
- **Assignments** — leads/customers routed to a partner to service.
- **Payouts** — what you owe partners, approved and paid.
- **Referrals** — business a partner brought in, attributed to them.

## Why run it in the Hub

Because a partner network is real money and real customer experience. Tracking
applications, assignments and payouts here means routing is fair, partners are
paid on time, and the whole programme is auditable rather than run on WhatsApp
and memory.
$md$,
  'ceo', 'stylists',
  ARRAY['stylists','programme','partners','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'stylists'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Applications & onboarding ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stylists-applications-and-onboarding',
  'From application to active partner',
  'Review incoming applications, approve the right stylists, and bring them on with an invite, a contract and their profile.',
  $md$
## Applications

Prospective stylists submit **applications** (the questions they answer are
configurable in programme **config**). You **review** each one and approve the
partners you want, so entry to the programme is deliberate, not automatic.

## Onboarding an approved partner

Once approved, a partner becomes a record you can:

- **invite** (give them access to the stylist portal),
- send a **contract** to (the agreement that governs the relationship),
- assign a **tier** and issue a **badge**,
- enrich with **specialities** and **certifications** (what they're good at and
  qualified for).

## Why the profile matters

Specialities and certifications aren't decoration — they feed **routing**. A
customer who needs a specific service should be matched to a partner who does it
well, and that's only possible if the partner's profile is real.
$md$,
  'ceo', 'stylists',
  ARRAY['stylists','applications','onboarding','contract','invite','badge'], 20
FROM shared.help_categories c WHERE c.slug = 'stylists'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Routing & assignments ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stylists-routing-and-assignments',
  'Routing leads and managing assignments',
  'Match a customer to the right partner — with a routing suggestion — then track the assignment through to completion.',
  $md$
## Routing a lead

When a customer needs a stylist, the programme can **suggest** a partner —
matching on speciality, tier and availability — so leads go to the right person
rather than the loudest. You confirm, and the lead becomes an **assignment**.

## Assignments

An **assignment** ties a customer/job to a partner and tracks it through its
stages to completion. It's the record of "who is serving whom", and it's what a
payout is ultimately calculated against.

## Reviews

After service, **reviews** capture how the partner did. Over time these feed a
partner's standing (and tier), so quality is rewarded and consistent problems
are visible.

## Fairness and accountability

Routing suggestions plus tracked assignments mean the programme is fair (leads
distributed on merit) and accountable (every lead has an owner and an outcome) —
the opposite of ad-hoc referral by chat.
$md$,
  'ceo', 'stylists',
  ARRAY['stylists','routing','assignments','leads','reviews'], 30
FROM shared.help_categories c WHERE c.slug = 'stylists'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Payouts & referrals ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stylists-payouts-and-referrals',
  'Paying partners and crediting referrals',
  'Payouts run through submit → approve → pay so partners are paid correctly and on time, and referrals are attributed to who earned them.',
  $md$
## Payouts

What you owe a partner is a **payout**. It runs through a controlled flow:

1. **Submit** the payout,
2. **Approve** it (management sign-off),
3. **Pay** it.

That approval step is why partners get paid the right amount by the right
person, with an audit trail — not a casual transfer someone forgot to log.

## What Insights watches

Praxis flags a payout **approved/processing but unpaid for 3+ days** (escalating
from 14) or **failed**. Because partners can serve both companies, these are
tracked cross-company so nothing owed slips between the two brands.

## Referrals

When a partner brings in business, the **referral attribution** credits it to
them — so their impact is measured and their payout reflects what they actually
generated. It's how the programme rewards partners who grow the business, not
just those who take assignments.
$md$,
  'ceo', 'stylists',
  ARRAY['stylists','payouts','approval','referrals','commission'], 40
FROM shared.help_categories c WHERE c.slug = 'stylists'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stylists-faq',
  'Stylist Programme FAQ',
  'Programme vs Studio, how leads are routed, why a payout was flagged, tiers/badges, and the partner portal.',
  $md$
## "Programme or Studio — which is which?"

**Stylist Studio** is your **in-house** styling floor (your staff). The
**Stylist Programme** is your network of **independent** partners. This module is
the external programme.

## "How are customers matched to a partner?"

The programme **suggests** a partner based on speciality, tier and availability;
you confirm and it becomes an **assignment**. Good matching depends on partner
profiles (specialities/certifications) being accurate.

## "Why was a payout flagged by Praxis?"

Because it's **approved/processing but unpaid for 3+ days**, or it **failed**.
Pay it (or fix the failure) and the flag clears — partners paid late is exactly
what the programme exists to prevent.

## "What do tiers and badges do?"

A **tier** grades a partner; a **badge** signals their standing. Tiers can affect
routing priority and payout terms, so they're a lever for rewarding your best
partners.

## "Can partners log in themselves?"

Yes — an **invited** partner gets access to the stylist portal to see their
assignments and payouts. You control access with the invite, and a **contract**
governs the terms.
$md$,
  'ceo', 'stylists',
  ARRAY['stylists','faq','studio','routing','payouts','portal'], 50
FROM shared.help_categories c WHERE c.slug = 'stylists'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'stylists'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
