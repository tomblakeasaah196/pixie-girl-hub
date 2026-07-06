-- ============================================================
-- MIGRATION 000271 — Help Center content: Production & Landed Cost
-- Pixie Girl Hub · V2.2 §6.9 (Production) · §6.30 (Help Center)
--
-- Seeds the full Production set: overview, production runs & stages,
-- landed cost, the Factory Account (ledger & shipments), rework, and a
-- FAQ.
--
-- Grounded in src/modules/production + apps/admin/src/pages/production:
-- tabs Overview / Factory Account / Production Runs (Ledger, Shipments);
-- runs create/advance/receive, landed-cost, rework.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('production', 'Production & Landed Cost',
   'Production runs, the true landed cost of finished goods, and the running factory account.',
   'Factory', 48)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'production-overview',
  'What Production tracks',
  'Turning raw goods into finished, sellable products — the runs that make them, the true landed cost of each, and the money owed to the factory.',
  $md$
## What it is

**Production** (sidebar → **Production**, or `/production`) covers turning raw
goods into the finished products you sell, and — crucially — capturing what each
finished item **truly costs** once everything (materials, work, freight, duties)
is added in.

## The tabs

- **Overview** — production at a glance and open work.
- **Factory Account** — the running account with your factory/partner: the
  **ledger** of what's owed/paid and the **shipments** coming from them.
- **Production Runs** — the batches themselves, each moving through stages to
  arrival.

## Why it exists separately

A price is only safe if you know the real cost behind it. Purchasing captures
what you paid a supplier; **Production rolls that up into landed cost** — the
all-in cost of the finished good — which is what **Pricing** needs to protect
margin. Getting this right is what stops you selling below cost by accident.
$md$,
  'ceo', 'production',
  ARRAY['production','landed-cost','overview','factory'], 10
FROM shared.help_categories c WHERE c.slug = 'production'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Production runs ───────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'production-runs',
  'Running a production batch',
  'Create a run, advance it through its stages, and receive the finished goods — which books them into stock.',
  $md$
## Creating a run

A **production run** is a batch of finished goods being made. Create it with
what's being produced and the inputs it consumes, then **advance** it through
its stages as work progresses.

## Receiving the output

When the batch is done and arrives, **receive** the run. Receiving books the
finished goods into **Stock** (as their variants) so they're immediately
sellable — the same "reception is the only way stock goes up" rule as everywhere
else.

## Timing and Insights

A run has an **expected arrival**. Praxis Insights flags a run **past its
expected arrival and not yet received** (escalating as it gets later), so a
delayed batch doesn't quietly hold up everything downstream.
$md$,
  'ceo', 'production',
  ARRAY['production','runs','stages','receive','stock'], 20
FROM shared.help_categories c WHERE c.slug = 'production'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Landed cost ───────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'production-landed-cost',
  'Understanding landed cost',
  'The all-in cost of a finished good — materials, work, freight and duties — computed per run so Pricing can protect your margin.',
  $md$
## What landed cost is

**Landed cost** is what a finished item *really* costs by the time it's on your
shelf: the raw materials, the styling/production work, plus freight, duties and
any other cost of getting it in. Not just the invoice price — the true, all-in
number.

## Where it's computed

Each production run has a **landed-cost** view that rolls up its inputs into a
per-unit cost for the goods it produced. That number is what feeds **Pricing**,
which is why margin and "below cost" checks can be trusted.

## Why it matters

If you price off the supplier invoice alone, you understate cost and quietly
erode margin — freight and duties are real money. Landed cost makes the true
floor visible, so the **Pricing** module's "selling below cost" insight is
meaningful rather than optimistic.
$md$,
  'ceo', 'production',
  ARRAY['production','landed-cost','margin','freight','duties'], 30
FROM shared.help_categories c WHERE c.slug = 'production'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Factory account & rework ──────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'production-factory-account',
  'The Factory Account and rework',
  'A running ledger of what''s owed to and shipped from your factory, plus a record of any rework a batch needed.',
  $md$
## The Factory Account

The **Factory Account** is the running account with your factory or production
partner:

- the **ledger** — money owed, deposits, payments, so you always know your
  standing with them,
- **shipments** — the batches on their way from the factory to you.

Keeping this in the Hub means the factory relationship isn't a side spreadsheet;
it reconciles with the runs and the goods that actually arrive.

## Rework

When a batch comes back short of quality, its **rework** is recorded against the
run — what had to be redone. This keeps a batch's real cost and history honest
(rework is cost), and makes a factory with a recurring rework problem visible
rather than absorbed silently.
$md$,
  'ceo', 'production',
  ARRAY['production','factory-account','ledger','shipments','rework'], 40
FROM shared.help_categories c WHERE c.slug = 'production'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'production-faq',
  'Production FAQ',
  'Landed cost vs supplier price, how a run reaches stock, why a run got flagged, and Production vs Purchasing.',
  $md$
## "Isn't landed cost just the supplier price?"

No — that's the trap. **Landed cost** adds freight, duties and production work to
the supplier price. Pricing off the invoice alone understates cost and eats
margin; landed cost is the real floor.

## "How do finished goods get into stock?"

By **receiving** the production run — that reception books the finished variants
into **Stock**. As always, a count only goes up through a recorded reception.

## "Why was a run flagged by Praxis?"

Because it's **past its expected arrival** and not yet received. Update its
status when it arrives (receive it), or chase the factory — the flag clears once
it's in.

## "How is this different from Purchasing?"

**Purchasing** buys raw goods and settles supplier invoices. **Production** turns
those into finished products and computes their **landed cost**. Purchasing is
the input; Production is where cost becomes truthful.

## "What's the Factory Account for?"

It's your running ledger with the factory — what you owe, what you've paid, and
the shipments due — so the partner relationship reconciles against actual runs
and receipts instead of living in a spreadsheet.
$md$,
  'ceo', 'production',
  ARRAY['production','faq','landed-cost','stock','purchasing','factory'], 50
FROM shared.help_categories c WHERE c.slug = 'production'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'production'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
