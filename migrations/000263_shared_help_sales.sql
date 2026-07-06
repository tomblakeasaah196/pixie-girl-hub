-- ============================================================
-- MIGRATION 000263 — Help Center content: Sales & Orders
-- Pixie Girl Hub · V2.2 §6.2 (Sales) · §6.30 (Help Center)
--
-- Populates the existing 'sales' category (seeded empty in 000214) with
-- the full Sales module set: overview, Quick Sale, orders & part-payments,
-- payment links, quotations, delivery-pending & cancellations, FAQ.
--
-- Grounded in the shipped module (src/modules/sales + apps/admin/src/
-- pages/sales): tabs Quick Sale / Orders / Quotations / Delivery Pending;
-- order timeline, payment links, receipts, quotation lifecycle,
-- cancellation-request approvals, Sales Report export.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

-- The 'sales' category already exists (000214). Upsert is a safe no-op.
INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('sales', 'Sales & Orders',
   'Quick Sale, orders, part-payments, payment links, quotations and delivery.',
   'ShoppingCart', 30)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'sales-overview',
  'How selling works in the Hub',
  'Everything you sell flows through Sales — a fast Quick Sale for walk-ins and DMs, full orders with part-payment, and quotations that convert to orders.',
  $md$
## One place for every sale

Since the POS was retired, **every sale runs through Sales** (sidebar →
**Sales**, or `/sales`). Whether it's a walk-in, an Instagram DM order or a
wholesale deal, it becomes an **order** here, and that order is what feeds
stock, invoicing, logistics and the dashboard.

## The four tabs

- **Quick Sale** — the fast path. Pick a customer (or add one), add products or
  a service, take payment, done. Built for speed at the counter or while
  replying to a DM.
- **Orders** — the full list: search, filter, open any order, take a payment,
  print a receipt, set the delivery fee, cancel.
- **Quotations** — formal quotes you send before an order exists; accepted
  quotes convert straight into an order.
- **Delivery Pending** — orders that are paid and waiting to be sent, with a
  badge count so nothing is forgotten.

## The KPIs at the top

Orders MTD, Revenue MTD, Pending Payment, Average Order Value and Open Quotes —
your selling pulse for the month, updating live.

## Stock and money stay honest

Confirming a sale draws the items down in **Stock** (the one true count) and,
where an invoice is raised, feeds **Invoicing** and the books. You never update
those separately — Sales does it as part of the transaction.
$md$,
  'all', 'sales',
  ARRAY['sales','orders','overview','quick-sale'], 10
FROM shared.help_categories c WHERE c.slug = 'sales'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Quick Sale ────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'sales-quick-sale',
  'Taking a Quick Sale',
  'The fastest way to record a sale: customer, items or a service, payment, receipt — in one short form.',
  $md$
## When to use Quick Sale

Use it for the common case: a customer in front of you or in your DMs who's
buying now. It's the same underlying order as everything else — just a
stripped-down form so you're not clicking through tabs.

## The flow

1. **Customer** — search an existing contact or add a new one inline. (A
   walk-in with no details can still be recorded.)
2. **Items** — add products/variants, or use **Service Quick Add** to bill an
   in-house service (a wig install, a colour job).
3. **Payment** — record what the customer paid. Full payment closes it; a
   part-payment leaves a balance (see part-payments).
4. **Receipt** — generate the receipt PDF to hand over or send.

## It's a real order

A Quick Sale creates a normal order in the **Orders** tab — so you can reopen
it later to add a payment, print another receipt, set a delivery fee or record
a delivery. Nothing about "quick" makes it lesser.
$md$,
  'staff', 'sales',
  ARRAY['sales','quick-sale','receipt','walk-in'], 20
FROM shared.help_categories c WHERE c.slug = 'sales'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Orders, part-payments & payment links ─────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'sales-orders-and-payments',
  'Orders, part-payments (layaway) and payment links',
  'Take money in instalments against one order, send the customer a secure pay-link, and keep a timeline of everything that happened.',
  $md$
## The Orders tab

Open any order to see its items, totals, payments and history. From here you
can add a payment, create a payment link, set the delivery fee, print a receipt
or cancel.

## Part-payments (layaway)

An order doesn't need to be paid in one go. **Add a payment** as many times as
you like against the same order; the Hub tracks the **balance** and the order
stays "pending payment" until it's cleared. This is how layaway works — the
customer pays over time and you can see exactly what's outstanding.

## Payment links

Instead of chasing bank transfers, create a **payment link** on the order and
send it to the customer. They pay through the configured gateway (Paystack /
Opay / Nomba / Stripe) and the payment lands back on the order automatically —
no manual "did it come in?" checking.

## The order timeline

Every order carries a **timeline** — payments, status changes, delivery notes,
messages. Staff can add entries (e.g. "customer asked to hold until Friday"),
and the customer-facing tracking view is built from it. It's the single story
of the order.

## Receipts and delivery fee

- **Receipt** — a styled PDF, regenerated any time.
- **Delivery fee** — set or adjust it on the order; it flows into the total and
  into Logistics.
$md$,
  'all', 'sales',
  ARRAY['sales','payments','layaway','installments','payment-link','timeline'], 30
FROM shared.help_categories c WHERE c.slug = 'sales'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Quotations ────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'sales-quotations',
  'Sending quotations and converting them',
  'Quote first, sell second: build a quotation, send it as a PDF, and turn an accepted quote into an order in one click.',
  $md$
## When you quote

For wholesale, bulk or considered purchases, send a **quotation** before an
order exists. It captures the items and price so the customer can approve
before committing.

## The lifecycle

1. **Create** the quotation with its line items.
2. **Send** it — generates a PDF and delivers it to the customer.
3. The customer **accepts** or **rejects** (you can also mark this on their
   behalf).
4. **Convert** an accepted quotation into a real order — no re-typing the
   lines. From there it behaves like any other order (payments, delivery,
   receipt).

## Why quote instead of just ordering?

A quotation doesn't touch stock or the books until it converts, so you can send
several without committing inventory. **Open Quotes** on the Sales KPIs shows
how many are still out awaiting a decision.
$md$,
  'all', 'sales',
  ARRAY['sales','quotations','quotes','convert','pdf'], 40
FROM shared.help_categories c WHERE c.slug = 'sales'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. Delivery-pending & cancellations ──────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'sales-fulfilment-and-cancellations',
  'Delivery Pending and cancelling an order',
  'The paid-but-not-sent queue keeps fulfilment honest, and cancellations go through a short approval so refunds are controlled.',
  $md$
## Delivery Pending

The **Delivery Pending** tab (with its badge count) lists orders that are
**paid but not yet dispatched** — your fulfilment worklist. Clearing it is how
you make sure a customer who has paid actually gets their goods. Once an order
is handed to a courier in **Logistics**, it drops off this list.

## Cancelling an order

Cancellation isn't a silent delete — it's a **request** that goes through
approval:

1. Staff **request cancellation** on the order (with a reason).
2. A manager **approves** or **rejects** it.
3. On approval the order is cancelled and any refund handling follows your
   finance rules.

This exists so a paid order can't just vanish — there's always a who/why and a
sign-off, which the audit log keeps.

## Sales Report export

Need the period on paper? **Export Report** (top of Sales, needs the *export*
permission) produces a styled `.xlsx` for a chosen date range — the same
figures as the KPIs and dashboard.
$md$,
  'all', 'sales',
  ARRAY['sales','delivery','fulfilment','cancellation','refund','export'], 50
FROM shared.help_categories c WHERE c.slug = 'sales'
ON CONFLICT (slug) DO NOTHING;

-- ── 6. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'sales-faq',
  'Sales FAQ',
  'Editing after payment, where the POS went, refunds, DM orders and how a sale reaches stock and the books.',
  $md$
## "Where's the POS / checkout screen?"

Retired by owner directive and replaced by **Quick Sale**. Everything the POS
did — walk-in checkout, staff sales — happens in Sales now, with one order
model instead of two.

## "Can I edit an order after taking payment?"

You can add payments, set the delivery fee, record delivery and reprint the
receipt. Changing the *lines* on an already-paid order is deliberately
constrained — for a real change, cancel (through approval) and re-create, so
money and stock stay reconcilable.

## "A customer paid in parts — is that supported?"

Yes. Add each payment against the same order; the balance tracks down to zero.
That's layaway. The order stays "pending payment" until cleared.

## "How do I take an Instagram/WhatsApp DM order?"

Use **Quick Sale** (or a full order) with the customer's contact, then send a
**payment link** so they pay without leaving the chat. The order and its
timeline keep the whole thread of what happened.

## "Do I need to update stock separately after a sale?"

No. Confirming a sale draws the items down in **Stock** automatically, and
invoiced amounts feed **Invoicing**/accounting. Sales is the source event —
the rest follow.
$md$,
  'all', 'sales',
  ARRAY['sales','faq','pos','refund','stock','dm-orders'], 60
FROM shared.help_categories c WHERE c.slug = 'sales'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'sales'
--   ORDER BY sort_order;  -- expected: 6 rows
-- ============================================================
