# Sales Collections & the Cash Collected KPI

**Status:** implemented · owner decisions locked 2026-10-07 · follows PR #750
(the Partially Paid collection filter)

Two things this document settles, because both were being answered wrongly by
the software:

1. **"Which active customers owe us money?"** — Sales → Orders now has an
   **Outstanding Balance** collection view (and a collections headline strip),
   alongside the existing **Partially Paid** view.
2. **"How much money did we take this month?"** — the primary monthly money KPI
   is **Cash Collected MTD** (payment ledger), not gross order value under a
   "Revenue" label.

Nothing here changes accounting journals, cancellation behaviour, the WhatsApp
unpaid-order expiry policy, or any historical order total.

---

## 1. The production audit this is based on

The snapshot the owner audited (Faitlynhair):

| | Orders | ₦ |
|---|---:|---:|
| Active part-paid balances | 2 | 480,000 |
| Active ₦0-paid `pending_payment` order | 1 | 1,258,000 |
| **Live outstanding balance (receivables)** | **3** | **1,738,000** |
| Cancelled, ₦0-paid historical orders | 43 | 23,774,175 |
| **Raw `balance_due_ngn > 0` rows in the table** | **46** | **25,512,175** |

The audit also established, and this work preserves:

- Order payment amounts match their captured/authorised payment rows, and active
  order/invoice payment and balance figures reconcile.
- A part-paid order can legitimately be `assigned`, `order_ready`, `dispatched`
  or `completed` — **lifecycle status is not a payment-state source of truth**.
- The earlier partial-payment Studio/stock backfill was verified (no duplicate
  stock deductions; service-only lines create jobs without stock movements) and
  is **not** touched here. Neither is cancellation history.

The gap: `SELECT SUM(balance_due_ngn) WHERE balance_due_ngn > 0` returns
₦25,512,175 and looks like a receivables figure. 93% of it is cancelled orders
nobody can collect from. Any collection view built on that raw total — or on the
narrower `partially_paid` filter — misinforms the owner.

---

## 2. Locked semantics

### Partially Paid (unchanged from PR #750)

```sql
so.amount_paid_ngn > 0
AND so.balance_due_ngn > 0
AND so.status NOT IN ('draft','cancellation_requested','cancelled','refunded','failed')
```

### Outstanding Balance (new)

```sql
so.balance_due_ngn > 0
AND so.status NOT IN ('draft','cancellation_requested','cancelled','refunded','failed')
```

- Every **active** order with a balance due: part-paid debtors **and** ₦0-paid
  orders (the WhatsApp / staff-negotiated slow lane).
- Draft, cancel-requested, cancelled, refunded and failed orders are out of the
  **live queue** — but their rows keep their totals and balances. Cancelled
  history is reported, never rewritten or zeroed.
- Partially Paid is a strict subset of Outstanding Balance.
- Both views are money queries; neither reads a lifecycle status as a payment
  state, and neither is limited to a payment plan or sales channel.

The exclusion list is defined **once**, in
`src/modules/sales/order-status.js` as `COLLECTION_EXCLUDED_STATES(_SQL)` (=
`SIDE_STATES`), and imported by every collections query so the list cannot
drift between the Orders filter, the collections summary and the report export.

### Cash Collected MTD (new primary money KPI)

```sql
SELECT SUM(amount_ngn)
  FROM <brand>.sales_order_payments
 WHERE status IN ('captured','authorised')
   AND COALESCE(captured_at, recorded_at) BETWEEN <Lagos month start> AND now()
```

- Gross captured/authorised **customer payments** whose money landed in the
  current Lagos calendar month. No fulfilment/order lifecycle status is used.
- `('captured','authorised')` is exactly the set the DB trigger
  `fn_sales_order_recompute_paid` (migration 000393) sums into
  `sales_orders.amount_paid_ngn`, so the KPI reconciles with what each order
  shows as paid. Pending / failed / refunded rows are not cash in.
- `COALESCE(captured_at, recorded_at)` is the established "when the money
  landed" expression (the pay page, receipts and the sales export already use
  it).
- **Gross order value is preserved, accurately labelled**: `order_value_mtd`
  (was `revenue_mtd`) is `SUM(total_ngn)` over the month's revenue-state orders.
  It is *what was sold* — it includes balances nobody has paid and excludes a
  deposit taken this month on an order placed last month — so it is never
  labelled revenue anywhere in the API or UI.
- Accounting journals are untouched: recognition stays where it was.

### WhatsApp / staff-negotiated unpaid orders (unchanged)

Zero-paid orders stay on the slow lane; their cancellation timing is a policy
question, not a collections one. This work makes them **visible** (Outstanding
Balance, the ₦0-paid split in the collections strip, Pending Payment tile)
instead of changing when they expire.

---

## 3. Where it lives

### Backend

| File | Change |
|---|---|
| `src/modules/sales/order-status.js` | `COLLECTION_EXCLUDED_STATES(_SQL)`, `SETTLED_PAYMENT_STATUSES(_SQL)`; SQL tuples now derived from the arrays; header documents order-value vs cash vs receivables |
| `src/modules/sales/sales.repo.js` | `listOrders({ outstanding_balance })`; `collectionsSummary()`; `reportCashCollected()` (capture-time scoped, unlike the order-scoped `reportPayments`) |
| `src/modules/sales/sales.service.js` | `collectionsSummary()`; the export now pulls period cash too |
| `src/modules/sales/sales.controller.js` / `.routes.js` | `GET /sales/orders?outstanding_balance=true`, `GET /sales/orders/collections-summary` (`sales.view`; declared before `/orders/:id`) |
| `src/modules/dashboards/dashboards.repo.js` | `salesKpis` returns `cash_collected_mtd` + `payments_mtd` and `order_value_mtd`; `revenue_mtd` is gone |
| `src/modules/dashboards/dashboards.service.js` | overview exposes `cash_collected_ngn` + `order_value_ngn` (no `revenue_ngn`) |
| `src/modules/dashboards/dashboards.metrics.repo.js` / `dashboards.details.repo.js` | the Dashboard's own `cashCollected` tile, Payment Methods donut and payments drill-down now use the SAME cash predicate (they summed every payment row by `captured_at` alone, so pending/failed charges counted as cash and uncaptured-stamp rows vanished) — one definition of cash across the product |
| `src/modules/sales/sales-report.export.js` | Summary: `Cash Collected in Period`, `Order Value (paid-state orders)`, `Outstanding Balance (active)` vs `Not Collectable (cancelled/refunded/failed)` |
| `src/modules/praxis_ai/query-catalogue.js` | `sales_summary` description tells Praxis which figure answers "how much did we take in" |
| `scripts/report-outstanding-balance.js` | `npm run report:outstanding` — the audit reconciliation per brand, plus the live queue (CSV with `--csv`) |

`GET /sales/orders/collections-summary` returns (money as strings, 2dp):

```json
{
  "outstanding_orders": 3,     "outstanding_balance_ngn": "1738000.00",
  "partially_paid_orders": 2,  "partially_paid_balance_ngn": "480000.00",
  "unpaid_orders": 1,          "unpaid_balance_ngn": "1258000.00",
  "excluded_orders": 43,       "excluded_balance_ngn": "23774175.00",
  "raw_balance_orders": 46,    "raw_balance_ngn": "25512175.00"
}
```

`outstanding + excluded = raw` always holds — that identity is the audit's
reconciliation, asserted in tests rather than trusted.

### Admin UI

- **Sales → Orders**: a **Collections** dropdown (All orders · Outstanding
  Balance · Partially Paid) beside the stage dropdown. `partially_paid` was
  moved out of the stage list — there it always meant the money filter, not the
  literal status — and a session persisted before the change is migrated on
  load. The stage dropdown and the collections view combine.
- **Collections strip** above the table: outstanding orders + ₦ (click to filter
  the list to them), the part-paid / ₦0-paid split, and the muted
  "Not collectable" tail.
- **Sales header tiles**: Orders MTD · **Cash Collected MTD** · **Order Value
  MTD** (hint: gross, not cash) · **Outstanding Balance** · Pending Payment ·
  Open Quotes.
- **Command Center**: "Revenue this month" → **"Cash collected this month"**.
- `KpiTile` gained an optional `hint` line so a related figure (or what a number
  excludes) sits with its headline instead of becoming another tile.

---

## 4. Tests

| Suite | What it proves |
|---|---|
| `tests/unit/sales/orders-outstanding-balance-filter.test.js` | the filter's SQL: balance-based, no `amount_paid_ngn` requirement, the exact exclusion set, no stage/plan/channel restriction, combines with an explicit stage; Partially Paid unchanged; the summary is read-only |
| `tests/unit/sales/orders-part-paid-filter.test.js` | PR #750's behaviour, unchanged (regression guard) |
| `tests/unit/dashboards/sales-kpis-cash-collected.test.js` | cash comes from `sales_order_payments` (`captured`/`authorised`, `COALESCE(captured_at, recorded_at)`, Lagos month), never from `total_ngn`/statuses; `revenue_mtd` is gone; overview mapping |
| `tests/unit/sales/collections-cash-db.test.js` → `tests/helpers/sales-collections-pglite.node.cjs` | **real SQL** under embedded PostgreSQL with the real 000393 trigger: the audited snapshot reconciles (46 / ₦25,512,175 raw → 3 / ₦1,738,000 live, 2 / ₦480,000 part-paid, 43 / ₦23,774,175 cancelled), cancelled history is untouched, every dead state is excluded, ₦0-paid and part-paid-at-`completed` orders are found, and Cash Collected counts a deposit taken this month on a 60-day-old order while Order Value does not |
| `tests/unit/sales/sales-report-export.test.js` | the workbook's collections split, the settled-status cash rule, capture-time cash precedence, and that no Summary label says "revenue" |

```bash
npx jest tests/unit/sales tests/unit/dashboards     # suites above
npm run report:outstanding                          # live reconciliation (needs DB)
```

---

## 5. Deliberately NOT done here

- **Accounting journals** — untouched, as instructed. Cash Collected is a
  management/reporting figure; recognition stays in the GL.
- **Cancellation timing / the WhatsApp unpaid-order expiry policy** — unchanged.
  ₦0-paid orders are surfaced, not expired sooner.
- **The partial-payment Studio/stock backfill and cancellation history** —
  verified by the audit and left exactly as they are. No cancelled order's
  totals or balances are altered or zeroed by any of this.
- **The analytics Dashboard module's `Revenue` labels** (Dashboard → Overview /
  Sales domains, the global "Combined Revenue" tile, and the attributed
  "Email / Storefront / Referral / Subscription Revenue" tiles) still read
  `SUM(total_ngn)` over `REVENUE_STATES` — gross order value under a revenue
  label. It is the same mislabel this document forbids, but renaming it spans
  marketing/ecommerce/retention attribution (where "revenue" is at least a
  deliberate attributed-value measure) plus the admin's hardcoded column
  headers, so it needs its own pass rather than a drive-by edit. Those screens
  already show a correctly-defined **Cash Collected** tile next to it. Tracked
  as the follow-up; the *primary monthly money KPI* surfaces (Sales header and
  Command Center) are fixed here.
