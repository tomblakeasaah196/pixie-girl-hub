-- ============================================================
-- MIGRATION 000275 — Help Center content: Invoicing & Billing
-- Pixie Girl Hub · V2.2 §6.3 (Invoicing) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Invoicing set: overview, raising & sending invoices,
-- part-payments & live AR ageing, credit notes & voids, reminders &
-- delivery, and a FAQ.
--
-- Grounded in src/modules/invoicing + apps/admin/src/pages/invoicing:
-- tabs Invoices / Credit Notes / AR Ageing / Settings; invoice pdf/void/
-- receipts/delivery/reminders; credit notes; document settings.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('invoicing', 'Invoicing & Billing',
   'Raising invoices, tracking part-payments, live AR ageing, credit notes and reminders.',
   'FileText', 50)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'invoicing-overview',
  'What Invoicing does',
  'Bill customers, watch what''s owed in real time, and handle credit and refunds cleanly — all partial-payment aware.',
  $md$
## What it is

**Invoicing** (sidebar → **Invoicing**, or `/invoicing`) turns a sale into a
formal bill, tracks what the customer still owes, and handles credit notes when
you need to reverse or refund. It is **partial-payment aware** throughout — an
invoice knows exactly how much has been paid and how much is outstanding.

## The tabs

- **Invoices** — the list: raise, send, take payment, void, print.
- **Credit Notes** — reversals and refunds against invoices.
- **AR Ageing** — your live accounts-receivable: who owes what, and how overdue.
- **Settings** — document numbering and templates for the invoices you send.

## Live AR, not a month-end report

Because payments post against invoices as they happen, **AR Ageing is live** —
not a report you compile at month end. What it shows is exactly what's owed
right now, bucketed by how late it is. That's the number the dashboard and
Praxis Insights read.

## Where it connects

Invoicing draws from **Sales** (the order) and **Contacts** (the customer), and
feeds **Accounting** (receivables and revenue). You don't re-key the customer or
the amounts — they flow from the order.
$md$,
  'all', 'invoicing',
  ARRAY['invoicing','billing','overview','ar'], 10
FROM shared.help_categories c WHERE c.slug = 'invoicing'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Raising & sending ─────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'invoicing-raising-and-sending',
  'Raising an invoice and getting paid',
  'Create an invoice, send it as a PDF with a pay link, take part-payments against it, and issue receipts.',
  $md$
## Creating an invoice

Raise an **invoice** from an order (or directly). It carries the line items,
totals, tax and the customer. Generate its **PDF** to send, and share a pay link
so the customer can settle online.

## Part-payments

An invoice doesn't have to be paid all at once. Payments post against it and the
**outstanding balance** tracks down — the invoice stays "part paid" until it's
cleared. This is what makes layaway-style billing and staged payments honest.

## Receipts and delivery

- Each payment can produce a **receipt**.
- The **delivery** panel links the invoice to how goods are getting to the
  customer, so the billing and the fulfilment tell one story.

## Numbering & templates

The invoice number format and the look of the PDF come from **Settings**
(document numbering + templates), so every invoice is consistent and sequentially
numbered — which the books and any audit rely on.
$md$,
  'all', 'invoicing',
  ARRAY['invoicing','invoice','pdf','part-payment','receipt'], 20
FROM shared.help_categories c WHERE c.slug = 'invoicing'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. AR ageing ─────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'invoicing-ar-ageing',
  'Reading AR Ageing and chasing overdue invoices',
  'The live view of who owes you and how late — with reminders and the Praxis overdue-invoice alert to keep cash coming in.',
  $md$
## What AR Ageing shows

**AR Ageing** buckets every unpaid (or part-paid) invoice by how overdue it is —
current, 30, 60, 90+ days. It's the single view of the money customers owe you,
and it updates live as payments land.

## Reminders

From an invoice you can send **reminders** to nudge a customer toward paying.
Used with the pay link, this is your low-effort collections routine — no
spreadsheet of who to chase.

## The Praxis alert

Praxis Insights flags an invoice **past its due date and not fully paid**, with
severity escalating by how overdue it is (Low under 30 days · Medium 30+ · High
60+ · Critical 90+). Working AR Ageing is exactly how you clear those flags —
and when an invoice gets paid, the flag auto-resolves on the next scan.

## Why "live" matters

Because AR is real-time, the overdue number on your dashboard is trustworthy at
any moment — you can act on cash-flow reality, not a stale month-end figure.
$md$,
  'ceo', 'invoicing',
  ARRAY['invoicing','ar-ageing','overdue','reminders','collections'], 30
FROM shared.help_categories c WHERE c.slug = 'invoicing'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Credit notes & voids ──────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'invoicing-credit-notes-and-voids',
  'Credit notes, refunds and voiding',
  'Reverse or refund cleanly with a credit note, or void an invoice raised in error — so the books always reconcile.',
  $md$
## Credit notes

When you need to reduce or refund an invoice — a return, an overcharge, a
goodwill credit — issue a **credit note** against it rather than editing the
original. The credit note is its own document that offsets the invoice, so both
sides of the story are kept and the books stay reconcilable.

## Voiding

An invoice raised **in error** (wrong customer, duplicate) can be **voided**.
Voiding cancels it without pretending it never existed — the number is retired
and the reason recorded, which is what an audit expects.

## Why not just delete or edit?

Because invoices are financial records feeding **Accounting**. Editing paid
history or deleting a number breaks the sequence and the reconciliation. Credit
notes and voids are the controlled ways to correct — they leave a clean trail.
$md$,
  'ceo', 'invoicing',
  ARRAY['invoicing','credit-note','refund','void','reconciliation'], 40
FROM shared.help_categories c WHERE c.slug = 'invoicing'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'invoicing-faq',
  'Invoicing FAQ',
  'Invoice vs receipt, editing after sending, part-payment, refunds, and how AR reaches the dashboard.',
  $md$
## "What's the difference between an invoice and a receipt?"

An **invoice** is a request for payment (what's owed). A **receipt** confirms
money received. One invoice can have several receipts as the customer pays in
parts.

## "Can I edit an invoice after sending it?"

Correct it the controlled way: a **credit note** (to reduce/refund) or a **void**
(if it was raised in error). Directly editing a sent/paid invoice would break the
books — the tools exist so corrections stay reconcilable.

## "A customer is paying bit by bit — is that fine?"

Yes. Payments post against the invoice and the outstanding balance tracks down.
The invoice stays part-paid until cleared.

## "How do I refund?"

Issue a **credit note** against the invoice for the refunded amount. It offsets
the invoice and records the reversal cleanly.

## "Where does the overdue number on my dashboard come from?"

From live **AR Ageing** here. Because payments post in real time, that figure is
current, and it's the same data Praxis uses to flag overdue invoices.
$md$,
  'all', 'invoicing',
  ARRAY['invoicing','faq','receipt','credit-note','refund','ar'], 50
FROM shared.help_categories c WHERE c.slug = 'invoicing'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'invoicing'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
