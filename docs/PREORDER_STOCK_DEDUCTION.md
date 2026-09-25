# Pre-order stock deduction — fulfilling a pre-order when its stock arrives

> Companion to universal pre-orders (migration 000086). This is the other half:
> once the stock a pre-order has been waiting on comes in, the Hub applies it to
> the pre-orders **first**, before that stock is ever exposed to a new sale.

## The problem this solves

Under universal pre-orders, an out-of-stock line is **accepted as a pre-order**
rather than blocked:

- At **placement**, each line tries to reserve stock. If the variant is out of
  stock, the line is flagged `is_preorder` (on the line and the order), a
  `preorder_ready_by` deadline is set, and the buyer is told it ships on the
  production window.
- When that order is **paid**, `markPaid` tries to draw each line from stock. A
  pre-order line has none, so the draw is savepointed and the line is recorded
  as a **shortfall** (an internal note + `order.stock_shortfall` → ops alert).
  The payment still goes through — the gateway already took the money.

So a **paid pre-order** is money taken with no stock behind it; an **unpaid
pre-order** (e.g. an instalment plan) is a placement waiting on its balance.
Until this feature, **nothing linked newly-received stock back to those waiting
orders** — ops had to notice by hand, days later, when a stylist couldn't be
assigned the hair.

## What happens now

Every stock receipt that **raises on-hand** — Goods Reception (a posted GRN),
production in, or a positive count/adjustment — triggers a pre-order
**allocation** for that variant:

| Pre-order state | Action when stock arrives |
|---|---|
| **Paid** (money landed — status paid/assigned/order_ready/dispatched/completed) | **Draw** the units (a `sale` movement) — exactly as `markPaid` would have if the stock had been there. Relieves the shelf; the line is fulfilled. |
| **Unpaid** (pending_payment / partially_paid) | **Reserve** the units — hold them for that order so a walk-in can't buy them out from under it. They draw normally when the balance is paid. |

**Priority when the arriving quantity can't cover everyone:** paid orders first,
then **oldest-first** within each group. Partial receipts allocate down that
queue until the arriving pool runs out; whatever is left keeps its pre-order flag
and is picked up by the next receipt.

Once a line is fully backed by stock its `is_preorder` flag clears; when an
order has no waiting lines left, `is_preorder` clears on the header and
`preorder_fulfilled_at` is stamped. Ops **and** sales are notified ("New stock
fulfilled N pre-orders — ready to assign/ship").

### Why the books stay right

The `order.paid` sale journal already posts **COGS + inventory relief** for every
line — including a pre-order line — at payment. A `sale` movement is deliberately
GL-excluded (the order.paid journal owns its COGS). So a paid pre-order draws
only the **physical** shelf; the receive that raised on-hand and this draw net to
zero inventory, which is exactly right — the unit came in and went straight out
to a buyer who already paid. No double posting.

### Why it can't double-draw (idempotency)

The arriving pool is `available = on_hand − reserved` under a row lock, and each
order's outstanding demand is **re-derived from the movement ledger** every pass
(units already drawn + units already reserved). So allocation only ever fills a
**genuine deficit against genuinely-available stock** — an at-least-once event
redelivery, or the deploy sweep running on top of the live path, allocates
nothing. Using `available` (not raw on-hand) as the pool also keeps the SSOT
invariant `reserved ≤ on_hand` true for both the draw and the reserve.

## How it runs

- **Live path** — `stock.service.applyMovement` enqueues a durable
  `stock.received` event (transactional outbox) on every inbound movement,
  deduped per movement. The worker dispatches it **post-commit** →
  `sales/preorder-allocation.service.allocateForVariant`. Post-commit so the
  allocator sees committed on-hand and its draws never bloat or roll back the
  goods receipt.
- **Safety net / backfill** — `scripts/backfill-preorder-allocations.js`
  (`npm run backfill:preorder-allocations`) sweeps every variant that still has
  an open pre-order and applies whatever stock is available, brand by brand. It
  is wired into the production deploy (`.github/workflows/ci.yml`, right after
  migrations) so **every deploy reconciles** anything the live path missed —
  history from before this feature, or an event dropped while the worker was
  down. Because allocation is idempotent, running it on every deploy is safe and
  a no-op when there's nothing to do. Each run is logged to
  `shared.preorder_allocation_runs` (so `hasEverRun` distinguishes the first
  historical backfill from a routine reconcile). Sweeps are silent — no customer
  email, no ops storm; the live path owns the ops/sales notification.

## Telling the customer — the email-only button

On the order (**Sales → order → the Pre-order card**) there's a
**"Notify customer (email)"** button. It sends a branded transactional email —
"your pre-ordered item has arrived and we're preparing it" — **by email only**.
It deliberately does **not** go through Comms Studio (which could pick a
configured WhatsApp/IG channel); it composes and sends straight through the email
service, so it can only ever reach the customer by email. It's manual (a human
decides when to send), refuses gracefully if the customer has no email on file,
and stamps `preorder_arrival_notified_at` (shown as "Customer emailed about
arrival on …"). Resend is allowed — stock can arrive in waves. Requires
`sales:edit`. Endpoint: `POST /api/v1/sales/orders/:id/preorder-arrival-email`.

## Where it lives

| Piece | File |
|---|---|
| Allocation engine | `src/modules/sales/preorder-allocation.service.js` |
| Live trigger (outbox) + ops/sales notify | `src/modules/sales/preorder-allocation.subscribers.js` |
| `stock.received` enqueue | `src/modules/stock/stock.service.js` (`applyMovement`) |
| Customer arrival email | `src/modules/sales/preorder-arrival.service.js` |
| Pre-order queries | `src/modules/sales/sales.repo.js` |
| Deploy/backfill reconcile | `scripts/backfill-preorder-allocations.js` |
| Fulfilment timestamps | `sales_orders.preorder_fulfilled_at`, `preorder_arrival_notified_at` (000097 / 000387) |
| Run audit table | `shared.preorder_allocation_runs` (000388) |
