-- ============================================================
-- MIGRATION 000270 — Help Center content: Purchasing & Imports
-- Pixie Girl Hub · V2.2 §6.8 (Purchasing) · §6.30 (Help Center)
--
-- Seeds the full Purchasing set: overview, suppliers & RFQs, the PO
-- lifecycle (approval), goods received notes & supplier invoices
-- (3-way match / landed cost feed), and a FAQ.
--
-- Grounded in src/modules/purchasing + apps/admin/src/pages/purchasing:
-- tabs Overview / Purchase Orders / Suppliers / GRN & Invoices; PO
-- statuses draft→submitted→approved→in_transit→received; RFQs, GRNs,
-- supplier invoices.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('purchasing', 'Purchasing & Imports',
   'Suppliers, RFQs, purchase orders, goods received notes and supplier invoices.',
   'ShoppingCart', 47)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'purchasing-overview',
  'What Purchasing handles',
  'Buying stock the controlled way: suppliers, quotes, approved purchase orders, goods received, and the supplier invoice that must match.',
  $md$
## What it is

**Purchasing** (sidebar → **Purchasing**, or `/purchasing`) is how stock comes
into the business — from finding a price to receiving the goods to paying the
supplier — with the controls that keep spend and inventory honest.

## The tabs

- **Overview** — the buying pulse and open work.
- **Purchase Orders** — your POs and where each sits (draft → submitted →
  approved → in transit → received).
- **Suppliers** — the vendors you buy from.
- **GRN & Invoices** — goods received notes and the supplier invoices you match
  and pay.

## The flow in one line

Add a **supplier** → optionally send an **RFQ** for a price → raise a **PO** and
get it **approved** → receive against it with a **GRN** (which books stock in) →
match the **supplier invoice** and pay. Each step is recorded, so what you
ordered, got and paid always reconcile.

## Where it connects

Receiving feeds **Stock** (the reception) and **Production** (landed cost); the
supplier invoice feeds **Accounting**. Purchasing is the front door for both
inventory and payables.
$md$,
  'all', 'purchasing',
  ARRAY['purchasing','imports','overview','suppliers','po'], 10
FROM shared.help_categories c WHERE c.slug = 'purchasing'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Suppliers & RFQs ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'purchasing-suppliers-and-rfqs',
  'Suppliers and requesting quotes',
  'Keep your vendors on file and, when you want the best price, send an RFQ and capture their quotes before committing to a PO.',
  $md$
## Suppliers

The **Suppliers** tab is your vendor directory — contact details, terms and the
products you buy from each. A supplier on file is what a PO is raised against,
and what the payables in Accounting are owed to.

## RFQs (request for quotation)

When you want to compare prices before buying, raise an **RFQ**: list what you
need, **send** it to one or more suppliers, and capture their **quotes**. You
then turn the best quote into a **purchase order** — no re-typing.

## Why quote first

For imports and larger buys, the RFQ step is where you protect margin: you
commit to a PO only after you've seen the price in writing. For routine
restocks you can skip straight to a PO.
$md$,
  'all', 'purchasing',
  ARRAY['purchasing','suppliers','rfq','quotes','vendors'], 20
FROM shared.help_categories c WHERE c.slug = 'purchasing'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. The PO lifecycle ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'purchasing-po-lifecycle',
  'Raising and approving a purchase order',
  'A PO moves draft → submitted → approved → in transit → received, with a printable PDF and an approval so spend is signed off.',
  $md$
## The statuses

A **purchase order** progresses through clear states:

1. **Draft** — you're building it.
2. **Submitted** — sent for approval.
3. **Approved** — signed off; now committed spend.
4. **In transit** — the supplier has shipped.
5. **Received** — booked in against a GRN.

You can generate a **PO PDF** to send to the supplier at any point.

## Why approval

Raising a PO commits money, so it goes through **approval** before it's live.
That's the control that stops uncontrolled buying — the person who raises it
isn't necessarily the person who authorises the spend, and the audit log keeps
both.

## What Praxis watches

Insights flags a PO **past its expected delivery date** and not received
(escalating as it gets later), and a PO **submitted but untouched for 7+ days** —
so nothing you're waiting on, or nobody's approving, gets forgotten.
$md$,
  'all', 'purchasing',
  ARRAY['purchasing','purchase-order','approval','pdf','lifecycle'], 30
FROM shared.help_categories c WHERE c.slug = 'purchasing'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. GRN & supplier invoices ───────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'purchasing-grn-and-invoices',
  'Goods received notes and matching supplier invoices',
  'Receiving against a PO books stock in and feeds landed cost; the supplier invoice is then matched to what you ordered and got before you pay.',
  $md$
## Goods received notes (GRN)

When goods arrive, raise a **GRN** against the PO. The GRN:

- records **what actually came** (which may differ from what was ordered),
- **books the stock in** (the reception in Stock),
- feeds **landed cost** in Production so the true cost of goods is captured.

Receiving through a GRN — rather than editing stock directly — is what keeps the
order, the receipt and the count reconcilable.

## Supplier invoices & the match

The **supplier invoice** is what you owe. Before paying, it's **matched**
against the PO (what you ordered) and the GRN (what you received) — the classic
three-way match. A mismatch (billed for more than received, wrong price)
surfaces here instead of being paid blind.

Matched supplier invoices feed **Accounting** as payables.

## Why it matters

This chain — PO → GRN → invoice — is the discipline that stops you paying for
goods you didn't get or prices you didn't agree. It's slower than "just pay the
bill", and that's the point.
$md$,
  'ceo', 'purchasing',
  ARRAY['purchasing','grn','supplier-invoice','three-way-match','landed-cost'], 40
FROM shared.help_categories c WHERE c.slug = 'purchasing'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'purchasing-faq',
  'Purchasing FAQ',
  'Do I need an RFQ, why a PO needs approval, partial deliveries, how receiving reaches stock, and invoice mismatches.',
  $md$
## "Do I always need an RFQ?"

No. Use an **RFQ** when you want to compare prices (imports, big buys). For a
routine restock at a known price, raise the **PO** directly.

## "Why does my PO need approval before I can send it?"

Because it commits spend. Approval separates raising an order from authorising
the money — the control that keeps buying under management sign-off.

## "The supplier only sent part of the order."

Receive what came on a **GRN** (it books in just those quantities). The PO stays
open for the rest; a shortfall against the expected delivery is exactly what
Insights will flag if it lingers.

## "Does receiving update stock automatically?"

Yes — a **GRN** is the reception, so it increases the count in **Stock** and
feeds landed cost. You never touch Stock separately for a purchase.

## "The invoice doesn't match the PO."

That's the **three-way match** catching a discrepancy — billed more than
received, or a different price. Resolve it with the supplier before paying;
don't override the match to push it through.
$md$,
  'all', 'purchasing',
  ARRAY['purchasing','faq','rfq','approval','grn','match'], 50
FROM shared.help_categories c WHERE c.slug = 'purchasing'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'purchasing'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
