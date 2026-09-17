# Order amendments — "Change Order"

**Spec:** Sales & Quotations (V2.2 §6.2)
**Permission:** `sales.edit`
**UI:** Sales → Orders → open an order → **Change Order** (`/sales/orders/:orderId`)
**API:** `POST /api/v1/sales/orders/:id/amendment/preview` · `POST …/amendment` · `GET …/amendments`
**Code:** `src/modules/sales/amendment.service.js` · `amendment.repo.js` ·
`amendment.subscribers.js` · `pricing/amendment-diff.js` ·
`apps/admin/src/pages/sales/ChangeOrderModal.tsx`

---

## The problem this solves

A customer pays, and only then does someone notice the order was recorded
against the wrong product. Before this feature the system had no correct answer:

| What you could do | What it cost you |
| --- | --- |
| Cancel and re-raise | Any deposit is **forfeited to Other Income** (policy Q7). The order number, the invoice, the Studio job and the customer's history on that sale are all lost. |
| Edit the row by hand | Stock, the GL, the invoice, the styling job and the delivery manifest all end up describing different orders. |

An amendment does the third thing: it changes the order **in place** and
reconciles every downstream module in one transaction. The customer keeps her
order number, her payment, her invoice and her place in the queue — she just
pays (or is credited) the difference.

## When it is allowed

Right up until the job is marked **Completed** (owner rule, 2026-08-16).
Refused outright for:

- `completed`, `cancelled`, `refunded`, `failed` — closed orders
- `cancellation_requested` — the money is already under review; settle that first

Everything in between is allowed, including `dispatched` — but a dispatched
order (or one whose delivery a courier already has) raises a warning the
operator must tick before it will save.

---

## The two worlds

Everything hinges on whether the order's **revenue has been recognised** — i.e.
whether `order.paid` already fired and posted the sale journal.
`isRevenueRecognised()` answers it from `journal_entries` (source_type `sales`),
falling back to `fully_paid_at` / a settled status for the rare order whose
journal failed to post.

| | Not recognised | Recognised |
| --- | --- | --- |
| Stock state | units are **reserved** | units have **left** (a `sale` movement) |
| Removing an item | `release_reserve` | `return` movement (which posts DR Inventory / CR COGS itself), then release any remaining hold |
| Adding an item | `reserve` — then an adjacent size, then a **pre-order** line | `deductForSale` — then an adjacent size, then a **pre-order** line |
| GL | **nothing** — the eventual `order.paid` journal uses the final figures | an **adjusting journal** for the difference |
| Invoice | the proforma is re-derived | the issued invoice is re-derived, and drops from `paid` → `partially_paid` when the total rose |

---

## What one amendment does, in order

All inside a single transaction, after taking the order row's write lock
(`FOR UPDATE`) so two operators pressing Save at once can't interleave.

1. **Guards** — amendable status, at least one line, and every `line_id` in the
   payload really belongs to this order.
2. **Re-price** (`buildPlan`) — see *Pricing rules* below.
3. **Warnings** — the consequences list. Without `acknowledge_warnings: true`
   the call returns `200 { requires_confirmation: true, warnings }` having
   written nothing (the same two-phase contract as the archive restore).
4. **Lines** — kept lines are `UPDATE`d in place so every FK pointing at them
   survives; new lines are inserted; removed lines are deleted **after** their
   Studio jobs have been dealt with.
5. **Order money** — header totals, and the delivery details when they moved.
6. **Stock** — reconciled from the **net per-variant delta** (see below).
7. **Accounting** — the delta journal, when revenue was recognised.
8. **Order status** — see *Status* below.
9. **Invoice** — `invoicing.resyncFromOrder`, in the same commit.
10. **Logistics** — the parcel's manifest and address, while it is still ours.
11. **Audit spine** — the `sales_order_amendments` row, the audit-log entry, and
    a customer-visible `order_amended` timeline event.
12. **Post-commit** — `order.amended` goes on the transactional outbox.

### Post-commit (`amendment.subscribers.js`)

- The **`order_amended`** Communications Studio automation (seeded by migration
  000380) — what changed, the new total, and the pay link when it costs more.
  Deduped **per amendment**, so a second change sends a second letter.
- The archived **invoice PDF** is re-rendered.
- **Studio jobs** are opened for any new styling work — but only when the order
  is already committed to production (fully paid, or a deposit-triggered order
  past its deposit), which is the same gate the ordinary Studio subscribers use.

Each step is individually best-effort: a Comms hiccup must not stop the PDF, and
neither must cost the Studio its job.

---

## Pricing rules

The governing principle: **never quietly change what the operator didn't
touch.**

**A kept line** (payload carries `line_id`) keeps its

- agreed **unit price** — a swap must not re-price the wig she already agreed to;
- **VAT rate** — a rate change in settings must not reach back into an old order;
- **cost snapshot** — an amendment is not a revaluation;
- **per-unit campaign discount**, so a quantity change scales the saving.

**A new line** is priced exactly as `createOrder` would price it: the operator's
explicit price if given, else the variant's price for **this order's own sales
channel**, with the product's live VAT and cost.

**Discounts are carried, never re-resolved.** The checkout offer engines
(campaign, coupon, points, bundle, referral) are *not* re-run: coupons and
points were already **spent** against the customer's balance on `order.paid`, so
re-running them would double-redeem. Instead:

- per-line campaign rows follow their line (and die with it when it's removed);
- order-level rows are summed and re-allocated across the new cart, **floor-free**
  (same policy as the campaign deal ladder — she was already shown and charged
  that saving, so clamping it now would overcharge her on the swap);
- `free_shipping` rows are excluded — their value was applied by zeroing
  `shipping_fee_ngn`, which is carried forward as-is.

If the new cart can't absorb the carried discount, the shortfall is reported as
a `DISCOUNT_CLIPPED` warning rather than silently swallowed.

The §6.25 **margin floor** is re-applied to every line, so a floor that moved
since the order was placed is caught.

---

## Stock: net per-variant, never per line

`netVariantDelta()` folds the before and after line sets into one signed
quantity per variant. This is the only figure the reconciler acts on, and the
reason matters:

- swapping "Medium" for "Large" of the same base is `-1` on one variant and
  `+1` on another;
- bumping the same variant from 1 to 3 is a single `+2` — doing it per line
  would release 1 and re-reserve 3, which **fails on the last unit on the
  shelf** when all the order actually needs is two more;
- re-adding the identical variant as a "new" line nets to zero and moves
  nothing.

Nothing in the reconciliation may fail the amendment. A unit that can't be found
becomes a **pre-order** line (exactly as it would at checkout) plus a warning on
the record — the customer's order must not be lost because a shelf was empty.

### Adjacency: "a unit that can't be found" means the sibling too

A size whose own base is exhausted is **not** automatically a pre-order. Rewig
adjacency (000088) lets a base one size up or down fill the order — same styling
job, no separate service or SKU — and a change that swaps an out-of-stock size
for one an adjacent base can cover must reach for it exactly as the original
sale would. The reconciler therefore walks the placement engine's chain, through
the same shared decision (`catalogue/rewig.service`): try the ordered variant,
then `resolveDonorVariant`, then pre-order. The brand switch, the listing's own
`rewig_override`, both bases' eligibility and the one-hop limit all apply, and
every read is scoped to the single location the reserve targets.

When it fires:

- the units are drawn from the sibling variant, and the line is **re-pointed**
  at it (`repointLineVariant` + a resize note) so the picklist, payment-time
  deduction, COGS and a later cancellation's release all follow the SKU that
  actually left the shelf — the customer's snapshot still reads her size;
- the preview warns `REWIG_SUBSTITUTION` instead of `STOCK_SHORT`, so what the
  operator is shown is what runs;
- it refuses to substitute a line that this order **partly holds on the ordered
  variant**: one line cannot honestly be picked from two SKUs, and a later
  release/return follows the line's variant. Those pre-order the extra units.
  (That rule is also what keeps the one-hop promise: a line already filled from
  a sibling has that sibling's unit claimed, so it never chains to a further
  one.)

### Made-to-order flags go down as well as up

`is_preorder` on the lines is derived from the **movement ledger**, not from the
plan: a line is made-to-order while the order does not hold (or, once paid, has
not drawn) everything its lines promise for that variant. Two consequences:

- **A change that puts the line on the shelf clears the flag.** Nothing used to
  lower it, so an order could hold every unit and still advertise a production
  window. Only lines this amendment actually asked stock for are re-judged —
  a delivery-only change never re-labels an untouched back-order.
- **A pre-order line's missing units get one chance to be taken.** Net-delta
  arithmetic assumes the order holds what it did before, but a pre-order line
  holds *nothing*, so moving only the difference leaves it permanently short of
  its own quantity. Lines that were already pre-orders and are part of this
  change are topped up to what they promise (`top_up: true` in the effects)
  before the flag is decided; if the stock isn't there, nothing changes.

The order-level flag still comes from `refreshPreorderFlag`, which is run after
the reconciler has ruled on the lines.

### `netSoldForOrder` and the re-settlement guard

`stock.repo.netSoldForOrder` reads what an order has actually drawn
(`sale` − `return`) from the movement ledger. Two callers depend on it:

- the amendment reconciler, so removing a line returns **exactly** what that
  order took (a pre-order line was never deducted, so it returns nothing);
- **`markPaid`**, which fixes a latent double-deduct: an order whose total later
  rises (a late delivery fee, or an amendment) goes back into balance, and the
  top-up payment re-enters addPayment's "this payment completed the order"
  branch. The `order.paid` fan-out is protected by the outbox dedup key, but the
  stock deduction was not — every line would have been taken off the shelf a
  second time.

---

## Accounting

`sales.postings.buildAmendmentLines`:

```
DR/CR  Customer Deposits 2400    Δtotal
CR/DR  Revenue (by channel)      Δnet  (subtotal − discount)
CR/DR  Shipping Revenue 4200     Δshipping
CR/DR  VAT Output 2100           Δtax
DR     COGS 5000 / CR Inventory FG 1300    cost of units ADDED
```

Each component posts on its natural side when the figure grew and the opposite
side when it shrank; since `Δtotal ≡ Δnet + Δshipping + Δtax` and the COGS pair
is self-balancing, the entry always balances (pinned in
`tests/unit/sales/amendment-postings.test.js`).

Three deliberate choices:

- **Why 2400 and not a receivable.** Policy Q7 routes every capture through
  Customer Deposits, so what she still owes for an upgrade sits there as a debit
  until her top-up credits it back — and a downgrade correctly leaves a credit
  balance as money we hold for her. That is the same account the refund or her
  next order draws on.
- **Removed units carry no COGS here.** The stock `return` movement posts its
  own DR Inventory / CR COGS at cost (`MOVEMENT_GL` in `stock.service`). Adding
  it here too would relieve inventory twice.
- **`source_type` is `accrual`, not `sales`.** Migration 000204 puts a partial
  UNIQUE index on `journal_entries(source_id) WHERE source_type='sales'` —
  exactly one sale journal per order, which is what the whole `order.paid`
  idempotency rests on. The adjusting entry carries
  `source_table='sales_order_amendments'` and an `idempotency_key` of
  `order_amend:<order_id>:<amendment_number>` (the generalised index from
  000226).

---

## Status

Only the **payment** states are touched. A wig already `assigned` or
`order_ready` stays there even when the swap re-opens a balance — the same rule
`markPaid` follows, because fulfilment progress is a physical fact and settling
money must never rewind it. The outstanding balance is expressed by
`balance_due_ngn`, which every screen already reads.

- `paid` and the new total is higher → back to `partially_paid`.
- An unsettled order that the change made **cheaper than what has already been
  paid** → the full `markPaid` path runs (stock draw + the `order.paid`
  fan-out), because from the business's point of view the order just became
  fully paid.

### Adding an item to an order that is already ready

An amendment that adds a styled product opens a **new Studio job**, so the
order that was "all done" now has outstanding work again. Two rules meet here,
and they resolve in the direction of not lying to the customer:

- **The status does not rewind.** `order_ready` is a physical fact (the earlier
  wigs really are packed), and the rule above holds — fulfilment never moves
  backwards.
- **The customer is not told twice.** The new hair's QC pass finds the order
  already at `order_ready`, so `advanceStatus` declines the move and returns
  `null` — which is exactly the signal the Studio uses to decide whether to
  send. No second "Order Ready" message, no second delivery.

What Ops sees instead is the truth: the order screen's Studio panel shows the
new count (`3 of 4 items ready`), and the Logistics queue drops the delivery
back to **Still in the studio** until the added hair is finished, because
readiness there is computed from *all* the order's jobs
(`order-readiness.js`). So the parcel can't leave half-packed even though the
order's own status stayed put.

---

## What it deliberately does NOT do

- **Take money.** An upgrade puts the order back into balance and the customer
  settles it through the ordinary rails (pay link / recorded payment).
- **Issue refunds.** A downgrade leaves a credit in Customer Deposits 2400.
  Whether that becomes cash back or credit against her next order is a Finance
  decision with its own approval path, not an Orders-screen button.
- **Retro-adjust commission or loyalty.** Both were accrued once, on the
  original settlement. The amendment records the full before/after so Finance
  can make the adjustment if they want one.
- **Cancel finished Studio work.** A job that was already completed is left
  alone — the labour happened, and the stylist's scorecard and any agreed cost
  are real. It simply detaches from the order (`sales_order_line_id` is
  `ON DELETE SET NULL`) so Ops can reassign the unit.
- **Touch a parcel a courier already has**, or a void/refunded invoice.

---

## Warnings (the confirm gate)

Each is a real, permitted consequence — not an error. The modal renders them and
the commit refuses without `acknowledge_warnings`.

| Code | Raised when |
| --- | --- |
| `REFUND_DUE` | A settled order gets cheaper — the difference becomes a customer credit. |
| `ORDER_DISPATCHED` | The order is already `dispatched`. |
| `DELIVERY_IN_TRANSIT` | The delivery is `picked_up` or later — contents won't be updated. |
| `STUDIO_WORK_DONE` | A removed item's styling job is already finished; it will be left open, not cancelled. |
| `STUDIO_WORK_STARTED` | A removed item's job is under way and will be cancelled. |
| `FREE_SHIPPING_OVERRIDDEN` | The order carries a free-delivery coupon and the fee is being changed. |
| `DISCOUNT_CLIPPED` | The new cart can't absorb all the discounts already granted. |
| `STOCK_SHORT` | Added units aren't in stock and will be recorded as a pre-order. |
| `REWIG_SUBSTITUTION` | The size ordered is out of stock but a size-adjacent base is in stock: the units will be taken from it and resized to fit, and the line is pointed at that SKU. |

---

## Data

`<brand>.sales_order_amendments` (template 000093, migration 000379). One row
per change, holding the full before/after of the money and the lines, the
normalised `line_changes` list, the delivery snapshots, and — crucially — an
`effects` JSONB recording exactly which downstream effects were applied. That
last part is what makes an amendment explainable months later: *"why does this
order's GL show a second journal?"* is answered by the row, not by archaeology.

Lines are snapshotted as JSONB rather than kept as rows: the live
`sales_order_lines` table is **replaced** by an amendment (removed lines are
deleted so invoices, picklists, Studio and Logistics all read the truth), so the
only durable record of what the order used to be lives here.

`sales_orders` also gains `amendment_count` and `last_amended_at`, denormalised
so the Orders register can badge an amended row without a join.

Migration 000379 also seeds the `order_amended` timeline event code (a hard FK
on `order_timeline_events.event_code`); 000380 seeds the `order_amended` Comms
Studio automation.

---

## Tests

| File | Covers |
| --- | --- |
| `tests/unit/sales/amendment-diff.test.js` | line diffing, net per-variant stock delta, the customer-facing summary, delivery-change detection |
| `tests/unit/sales/amendment-plan.test.js` | re-pricing: kept-line price/VAT/cost carry-forward, discount carry-forward and clipping, delivery detection, reference guards |
| `tests/unit/sales/amendment-postings.test.js` | the GL delta balances in every direction, and posts nothing when nothing moved |
| `tests/unit/sales/amendment-rewig.test.js` | the stock reconciler's adjacency fallback end to end: units drawn from the sibling base and the line re-pointed, the brand/listing gates refusing it, the partial-hold refusal, the pre-order top-up and flag clearing, and the recognised-order deduction path |
