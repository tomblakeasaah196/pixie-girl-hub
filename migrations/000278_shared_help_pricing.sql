-- ============================================================
-- MIGRATION 000278 — Help Center content: Pricing Engine
-- Pixie Girl Hub · V2.2 §6.16 (Pricing) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Pricing set: overview, the Advisor & effective price,
-- rules/floors/overrides, per-channel & currency fee gross-up, proposals
-- & scenarios, and a FAQ.
--
-- Grounded in src/modules/pricing + apps/admin/src/pages/pricing: tabs
-- Advisor / Floors / Overrides / Proposals / Rules / Scenarios / Settings;
-- recommend, apply, effective/history per variant, rules, floors,
-- overrides, scenarios, proposals (approve).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('pricing', 'Pricing Engine',
   'Margin, price floors, per-channel and currency fee gross-up, and controlled price changes.',
   'Tag', 53)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'pricing-overview',
  'What the Pricing Engine does',
  'It works out the right price for every variant on every channel — protecting margin, covering fees, and never dropping below the floor.',
  $md$
## What it is

The **Pricing Engine** (sidebar → **Pricing**, or `/pricing`) decides what each
variant should sell for — not a single sticker price, but the **right price per
channel and currency**, built up from cost, target margin and the fees a channel
charges.

## The tabs

- **Advisor** — the recommended price and why (cost, margin, fees).
- **Rules** — the margin/markup rules that drive recommendations.
- **Floors** — the price you will never go below.
- **Overrides** — deliberate exceptions to the computed price.
- **Proposals** — price changes awaiting approval.
- **Scenarios** — model a change before committing.
- **Settings** — engine configuration.

## Why an engine, not a spreadsheet

Because "the price" depends on **landed cost** (from Production), the **channel**
(storefront vs POS vs wholesale vs partner), the **currency** and its **fees**.
Doing that by hand across a catalogue is where margin quietly dies. The engine
computes it consistently and flags anything selling **below cost or below floor**.
$md$,
  'ceo', 'pricing',
  ARRAY['pricing','margin','overview','engine'], 10
FROM shared.help_categories c WHERE c.slug = 'pricing'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Advisor & effective price ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'pricing-advisor-and-effective',
  'The Advisor, the effective price and fee gross-up',
  'See the recommended price for a variant, the actual effective price it sells at, and how per-channel and currency fees are grossed up so you keep your margin.',
  $md$
## The Advisor

The **Advisor** recommends a price for a variant by taking its **cost**, applying
your **margin rule**, and **grossing up** for the fees the channel and currency
impose — so the amount you actually keep hits your target.

## Effective price & history

- The **effective price** is what a variant currently sells at on a given
  channel (after rules, overrides and floors resolve).
- **History** shows how a variant's price has moved over time — useful when a
  customer or partner asks why it changed.

## Fee gross-up (the important bit)

If a channel or payment currency takes, say, a few percent, selling at your
"target" price actually nets you **less**. The engine **grosses up** the price so
that after the fee you still hit your intended margin. This is why the same
product can carry different prices on the storefront, POS, wholesale and partner
channels — each has different fees.
$md$,
  'ceo', 'pricing',
  ARRAY['pricing','advisor','effective-price','gross-up','fees','channel'], 20
FROM shared.help_categories c WHERE c.slug = 'pricing'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Rules, floors & overrides ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'pricing-rules-floors-overrides',
  'Rules, floors and overrides',
  'Rules set the target margin, floors set the hard line you won''t cross, and overrides are the deliberate, tracked exceptions.',
  $md$
## Rules

**Rules** define how price is derived — the target margin or markup applied to
cost. Set them once and the Advisor uses them across the catalogue, so pricing is
a policy, not a per-product guess.

## Floors

A **floor** is the price you will **never** go below for a variant/channel — your
hard line. The engine and the storefront respect it, and Praxis Insights flags
anything **below its floor** (Medium) or **below cost** (High, Critical when more
than 10% below). Floors are how a discount or an FX swing can't accidentally sell
you into a loss.

## Overrides

An **override** is a deliberate exception — a promotional price, a strategic
loss-leader, a special for one channel. Because it's an explicit override (not an
edit to the rule), it's tracked and reversible, and everyone can see it was a
choice, not a mistake.
$md$,
  'ceo', 'pricing',
  ARRAY['pricing','rules','floors','overrides','below-cost'], 30
FROM shared.help_categories c WHERE c.slug = 'pricing'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Proposals & scenarios ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'pricing-proposals-and-scenarios',
  'Proposing price changes and modelling scenarios',
  'Model a change as a scenario, then submit it as a proposal that a manager approves before it goes live — no silent repricing.',
  $md$
## Scenarios

A **scenario** lets you model a pricing change — a margin bump, a fee change, an
FX move — and see the effect **before** committing. It's the "what if" sandbox,
so you're not guessing at the impact on margin.

## Proposals (approval-gated)

A live price change goes through a **proposal**: you propose the new prices, and a
manager **approves** before they take effect. Repricing isn't a silent edit — it's
a reviewed decision, which matters because price is margin and customer trust.

## Why gate it

A wrong price at scale is expensive both ways — too low bleeds margin, too high
loses sales. The proposal step (with scenarios to model first) means significant
changes are seen and signed off, and the history records who changed what and
when.
$md$,
  'ceo', 'pricing',
  ARRAY['pricing','proposals','scenarios','approval','reprice'], 40
FROM shared.help_categories c WHERE c.slug = 'pricing'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'pricing-faq',
  'Pricing FAQ',
  'Why one product has several prices, below-cost flags, changing a price, floors vs overrides, and where cost comes from.',
  $md$
## "Why does the same product have different prices per channel?"

Because each channel and currency has different **fees**. The engine **grosses
up** so you keep the same margin after fees — which means the sticker differs by
channel even though your take is consistent.

## "Praxis says a variant is selling below cost."

The effective price on some channel dropped under its **landed cost** (or below
its **floor**). Fix the price, the rule, or the override — the flag auto-resolves
once it's back above the line. Below cost is High; more than 10% below is
Critical.

## "How do I change a price properly?"

Model it as a **scenario**, then submit a **proposal** for approval. Approved
proposals go live; the change is recorded. Avoid ad-hoc edits — they skip the
review and the trail.

## "Floor vs override — what's the difference?"

A **floor** is the line you won't cross (a safety limit). An **override** is a
chosen exception to the computed price (a promo). One protects you; the other is a
deliberate move.

## "Where does the cost behind the price come from?"

From **Production's landed cost** (all-in cost of the finished good). Accurate
landed cost is what makes the margin and below-cost checks trustworthy.
$md$,
  'ceo', 'pricing',
  ARRAY['pricing','faq','channel','below-cost','floor','landed-cost'], 50
FROM shared.help_categories c WHERE c.slug = 'pricing'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'pricing'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
