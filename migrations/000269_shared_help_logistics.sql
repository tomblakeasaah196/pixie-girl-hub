-- ============================================================
-- MIGRATION 000269 — Help Center content: Logistics & Delivery
-- Pixie Girl Hub · V2.2 §6.7 (Logistics) · §6.30 (Help Center)
--
-- Seeds the full Logistics set: overview, the delivery queue & lifecycle,
-- zones & shipping rates, couriers & proof-of-delivery & tracking, and a
-- FAQ.
--
-- Grounded in src/modules/logistics + apps/admin/src/pages/logistics:
-- tabs Queue / Active / Delivered / Issues / All / Shipping Rates;
-- zones (quote, rates template/import), couriers, deliveries (letter,
-- status transitions), POD collections, public tracking.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('logistics', 'Logistics & Delivery',
   'Getting orders to customers — the delivery queue, zones & rates, couriers, proof of delivery and tracking.',
   'Truck', 46)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'logistics-overview',
  'What Logistics handles',
  'From a paid order to a delivered parcel: the queue of what needs sending, the couriers who carry it, and the tracking the customer follows.',
  $md$
## What it is

**Logistics** (sidebar → **Logistics**, or `/logistics`) is where a paid order
becomes a delivered parcel. It manages the deliveries, the couriers who carry
them, the zones and rates that price them, and the tracking the customer
follows.

## The tabs

- **Queue** — deliveries waiting to go out (the fulfilment worklist).
- **Active** — in-flight deliveries.
- **Delivered** — completed.
- **Issues** — failed / lost / damaged / returned — the ones that need
  attention.
- **All** — everything.
- **Shipping Rates** — the zones and prices that quote a delivery fee.

## Where it plugs in

A **Delivery Pending** order in Sales becomes a delivery here; the fee flows
from the **zone/rate**; the status you set (dispatched, delivered, failed) is
what the customer's **tracking** page and **Praxis Insights** read. It closes
the loop from sale to doorstep.
$md$,
  'all', 'logistics',
  ARRAY['logistics','delivery','overview','couriers'], 10
FROM shared.help_categories c WHERE c.slug = 'logistics'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. The delivery lifecycle ────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'logistics-delivery-lifecycle',
  'Booking and tracking a delivery',
  'Create a delivery, print its letter, assign a courier, and move it through dispatched → delivered — recording proof at the door.',
  $md$
## Creating a delivery

From an order ready to ship, create a **delivery**: destination, items, courier
and fee. You can generate a **delivery letter** (the printable document that
travels with the parcel).

## Moving it along

A delivery progresses through status:

- **Queued → dispatched** — handed to the courier and on its way (now on
  **Active**).
- **Delivered** — arrived; record **proof of delivery (POD)**.
- **Failed / lost / damaged / returned** — the exceptions, which land on the
  **Issues** tab.

## Proof of delivery

Capturing **POD** at the door (and reconciling **POD collections** for
cash-on-delivery) is how "we think it arrived" becomes "we know it did." It's
also what protects you in a dispute.

## What Insights watches

Praxis flags a delivery that's **failed/lost/damaged/returned** (lost or damaged
= Critical) and an in-flight delivery **past its expected time** (High past 48
hours). Working the **Issues** tab is how you clear those.
$md$,
  'all', 'logistics',
  ARRAY['logistics','delivery','lifecycle','pod','tracking','letter'], 20
FROM shared.help_categories c WHERE c.slug = 'logistics'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Zones & shipping rates ────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'logistics-zones-and-rates',
  'Delivery zones and shipping rates',
  'Define zones and their prices once, and every order quotes the right delivery fee automatically — including bulk import.',
  $md$
## Zones

A **zone** is a geographic area you deliver to. On the **Shipping Rates** tab
you define your zones and the **rate** for each, so a delivery fee isn't guessed
per order — it's looked up.

## Quoting a fee

The **quote** function returns the delivery fee for a destination from your
zones and rates. That's what fills the delivery fee on an order, keeping pricing
consistent across staff and channels.

## Bulk rates

For a big rate table, use the **rates template**: export the template, fill it
in, and **import** it — rather than adding zones one at a time. Handy when you
onboard a new courier or restructure pricing.

## Keeping it current

Rates drift (fuel, courier changes). Because every order quotes from here,
updating a zone's rate updates every future quote at once — one place to change,
everywhere corrected.
$md$,
  'ceo', 'logistics',
  ARRAY['logistics','zones','rates','shipping','quote','import'], 30
FROM shared.help_categories c WHERE c.slug = 'logistics'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Couriers & tracking ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'logistics-couriers-and-tracking',
  'Couriers and the customer tracking page',
  'Manage the couriers you use and give customers a public tracking link so they follow the parcel without messaging you.',
  $md$
## Couriers

Keep your **couriers** on file — the carriers you dispatch with. A delivery is
assigned to a courier, so you can see who's carrying what and hold the right
partner accountable when something goes wrong.

## Public tracking

Each delivery has a **public tracking** page the customer can open without
logging in. It's built from the order timeline and delivery status, so as you
move a delivery along, the customer's page updates — cutting down "where's my
order?" messages.

## POD collections

For cash-on-delivery, **POD collections** reconcile the money the courier
collected against what was owed, so COD cash is tracked rather than trusted.

## The connection to Storefront Studio

The vocabulary and templates behind the tracking timeline and delivery letters
are configured in **Storefront Studio** — Logistics uses them; Studio defines
them.
$md$,
  'all', 'logistics',
  ARRAY['logistics','couriers','tracking','pod','cod'], 40
FROM shared.help_categories c WHERE c.slug = 'logistics'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'logistics-faq',
  'Logistics FAQ',
  'Where the delivery fee comes from, handling failed deliveries, tracking links, COD cash, and the Issues tab.',
  $md$
## "Where does the delivery fee come from?"

From your **zones and rates**. The system **quotes** the fee for the
destination; it's set on the order (Sales) and carried into the delivery. Change
a zone's rate and future quotes follow.

## "A delivery failed — what do I do?"

It moves to the **Issues** tab and is flagged by Praxis (lost/damaged =
Critical). Decide the outcome — redeliver, refund, claim against the courier —
and record it. Don't leave it in Issues; that's the point of the tab.

## "Can the customer track their order themselves?"

Yes — every delivery has a **public tracking** link that updates as you change
status. Send it once and they stop asking.

## "How is cash-on-delivery money tracked?"

Through **POD collections** — the courier's collected cash is reconciled against
what was owed, so COD isn't a trust exercise.

## "Why is a delivery flagged when it hasn't 'failed'?"

Because it's **past its expected time** while still in flight (Praxis raises this
at Medium, High past 48 hours). Chase the courier or update the status.
$md$,
  'all', 'logistics',
  ARRAY['logistics','faq','fee','failed','tracking','cod'], 50
FROM shared.help_categories c WHERE c.slug = 'logistics'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'logistics'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
