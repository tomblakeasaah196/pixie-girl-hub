-- ============================================================
-- MIGRATION 000267 — Help Center content: Stock & Inventory
-- Pixie Girl Hub · V2.2 §6.5 (Stock SSOT) · §6.30 (Help Center)
--
-- Seeds the full Stock set: overview (one true count), goods reception,
-- movements & transfers, adjustments (approval workflow), reorder
-- alerts & valuation, and a FAQ.
--
-- Grounded in src/modules/stock + apps/admin/src/pages/stock: tabs
-- Overview / Goods Reception / Movements / Transfers / Adjustments /
-- Alerts / Locations; adjustment submit→approve→post; transfer
-- dispatch→receive; reorder alerts ack/dismiss/resolve; valuation.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('stock', 'Stock & Inventory',
   'The one true count — reception, movements, transfers, controlled adjustments and reorder alerts.',
   'Boxes', 41)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stock-overview',
  'Stock is the one true count',
  'Every other module reads its inventory from here. Stock is the single source of truth — nothing changes a count except a recorded movement.',
  $md$
## The one true count

**Stock** (sidebar → **Stock**, or `/stock`) is the **single source of truth**
for how much of everything you have. Sales, Catalogue, Purchasing, Production
and Logistics all read from it — none of them keep their own private count.

The rule that makes it trustworthy: **a count only changes through a recorded
movement.** A sale draws down; a goods reception adds up; a transfer moves
between locations; an adjustment corrects — and every one of those is logged
with who, when and why.

## The tabs

- **Overview** — levels at a glance, low-stock signals, valuation.
- **Goods Reception** — receiving stock in (from a PO/shipment).
- **Movements** — the full history of every in/out.
- **Transfers** — moving stock between locations.
- **Adjustments** — controlled corrections (with approval).
- **Alerts** — reorder and negative-stock signals to act on.
- **Locations** — your warehouses/shops/shelves.

## Real-time

Stock changes push in real time — a sale on one screen updates the count on
another without a refresh. That's why the number you see is the number that is.
$md$,
  'all', 'stock',
  ARRAY['stock','inventory','ssot','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'stock'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Receiving & movements ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stock-receiving-and-movements',
  'Receiving stock and reading movements',
  'Book goods in against a shipment, and use the movements log to see exactly how every count got to where it is.',
  $md$
## Goods reception

When stock arrives, receive it on the **Goods Reception** tab (or via a
**shipment** from Purchasing/Production). Receiving:

- **increases** the count at the destination location,
- records the **landed** items so Purchasing/Production can reconcile against
  the order,
- leaves a movement in the log.

Receiving is how "it's in the building" becomes "it's in the system" — do it
promptly so the count and reality match.

## Movements

The **Movements** tab is the complete history — every in and out, its type
(sale, reception, transfer, adjustment), quantity, location and timestamp. When
a count looks wrong, this is where you find *why*: nothing moves without a line
here.

## Levels & valuation

- **Levels** show current quantity per variant and location; you can look up a
  single variant's stock.
- **Valuation** values the inventory you hold (a restricted, cost-aware figure)
  for the finance view.
$md$,
  'all', 'stock',
  ARRAY['stock','reception','movements','levels','valuation'], 20
FROM shared.help_categories c WHERE c.slug = 'stock'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Transfers & adjustments ───────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stock-transfers-and-adjustments',
  'Transfers between locations and controlled adjustments',
  'Move stock location-to-location with a dispatch/receive handshake, and correct counts through an approval so no one can quietly change inventory.',
  $md$
## Transfers

To move stock between locations, raise a **transfer**. It's a two-step
handshake:

1. **Dispatch** from the source (stock leaves that location, marked in transit),
2. **Receive** at the destination (stock lands there).

Until it's received, the transfer is in transit — so goods can't be double-
counted at both ends, and a transfer that never arrives is visible.

## Adjustments go through approval

A correction to the count — breakage, a stock-take difference, a found item —
is an **adjustment**, and it is **not** a free edit. The flow is:

1. **Create** the adjustment (with a reason),
2. **Submit** it,
3. A manager **approves** (or rejects),
4. **Post** it — only now does the count actually change.

## Why the ceremony

Because the count is the source of truth, letting anyone silently change it
would break every module that trusts it. The submit → approve → post workflow
means every correction has a reason and a sign-off, all captured in the audit
log.
$md$,
  'all', 'stock',
  ARRAY['stock','transfers','adjustments','approval','workflow'], 30
FROM shared.help_categories c WHERE c.slug = 'stock'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Alerts & reorder ──────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stock-alerts-and-reorder',
  'Reorder alerts and negative-stock warnings',
  'The Alerts tab tells you what to reorder before you run out, and flags impossible counts so data errors surface fast.',
  $md$
## The Alerts tab

**Alerts** is your restock worklist. It raises a signal when a variant hits its
**reorder point**, and a red flag for **negative stock** (a count below zero —
which should be impossible, so it means something needs fixing). You can
**acknowledge**, **dismiss** or **resolve** each alert.

## How Praxis Insights uses it

The same conditions drive the Stock card in **Praxis Insights**: reorder point
reached is Medium, under half the reorder point is High, **zero** is Critical,
and **negative** stock is always Critical. Stock is scanned at **08:00 and
14:00**. Acting on an alert here (restocking, correcting) clears the insight on
the next scan.

## Setting reorder points

Reorder points live on the variant (Catalogue/Stock). Set them realistically —
too low and you stock out before the alert is useful; too high and you drown in
noise. The alert is only as good as the threshold behind it.
$md$,
  'all', 'stock',
  ARRAY['stock','alerts','reorder','low-stock','negative-stock'], 40
FROM shared.help_categories c WHERE c.slug = 'stock'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'stock-faq',
  'Stock FAQ',
  'Why I can''t just edit a number, where a count went, negative stock, transfers in limbo, and per-location counts.',
  $md$
## "Why can't I just type the correct number?"

Because everything trusts this count. A direct edit would have no reason and no
sign-off. Use an **adjustment** (create → submit → approve → post) — same
result, but with a why and a who that the audit log keeps.

## "The count looks wrong — how do I find out why?"

Open **Movements** for that variant. Every change is a line: sale, reception,
transfer, adjustment. The wrong number always has a movement (or a missing one)
behind it.

## "It says negative stock — is that possible?"

It shouldn't be, which is why it's flagged Critical. It usually means a sale was
recorded before a reception, or a reception was missed. Find the missing
movement and correct with an adjustment.

## "A transfer is stuck 'in transit'."

It was **dispatched** but not yet **received**. Receive it at the destination to
complete it. A transfer that stays in transit too long is worth chasing — the
goods left one place and haven't been booked in at the other.

## "Do counts split by location?"

Yes. Stock is tracked **per location**, so you know not just how much you have
but *where*. Transfers move it between them.
$md$,
  'all', 'stock',
  ARRAY['stock','faq','adjustments','movements','locations'], 50
FROM shared.help_categories c WHERE c.slug = 'stock'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'stock'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
