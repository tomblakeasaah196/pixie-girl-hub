# P1 — Finance Wiring Implementation Plan

**Track:** P1 (finance correctness) from `CONFORMANCE_GAPS.md` — items
W-1, W-2, W-3, W-4, W-5, W-6.
**Why first:** self-contained, high audit value, no front-end dependency.
The schema is already in place for all six; this is service-layer work.
**Date:** 2026-06-08.

Each item below lists the goal, the exact files to touch (grounded in the
current code), the steps, and a verification check. Effort is rough
engineer-days.

---

## Sequencing

```
Phase 1 (land together — share a GL-posting helper):
  W-1 payment_model behaviour  ──┐
  W-6 Cash Request module       ─┴─> both post journals + touch money flow
Phase 2 (independent reports):
  W-2 invoicing dual-currency
  W-3 cash flow statement
  W-4 AR/AP ageing
Phase 3 (depends on W-2):
  W-5 FX gain/loss
```

Build a small shared helper first: `accounting.postEntry` already exists
(`src/modules/accounting/accounting.service.js`) and is reused by expenses.
W-1 and W-6 should both call it rather than hand-rolling journals.

---

## W-1 — `payment_model` behaviour (sales 6.2) · ~2 days

**Goal.** Make Layaway vs Deposit-triggered actually _do_ something. Today
`payment_model` is stored on the order (`sales.service.js:179`) but
`addPayment`→`markPaid` only ever acts at **full** payment.

**Files.**

- `src/modules/sales/sales.service.js` — `addPayment` (line 270),
  `markPaid` (line 337).
- `src/jobs/schedulers/layaway-abandonment.js` (TODO stub).
- `src/jobs/schedulers/layaway-reminders.js` (TODO stub).
- Reads `business_config.installment_settings`
  (`default_deposit_percent`, `layaway_abandonment_days`,
  `layaway_reminder_cadence_days`) via business-setup repo.

**Steps.**

1. In `addPayment`, after recomputing `amount_paid_ngn`, branch on
   `order.payment_model`:
   - `full_payment_only` / `layaway`: keep current behaviour — only
     `markPaid` (stock deduct + `order.paid`) when paid in full. Layaway
     reserves at placement (see step 2).
   - `deposit_triggered`: when cumulative paid ≥ `deposit_percent × total`
     **and** status is still `pending_payment`, flip to `in_production`,
     emit a new `order.deposit_met` event (Production/Service-Job consumes
     it), but do **not** deduct sellable stock yet. At full payment, run
     the existing `markPaid` → dispatch path.
2. Layaway reservation: on `createOrder` for `layaway` items, write a
   stock **reservation** (not a sale movement) so the unit is held. Release
   on cancel/abandonment.
3. Implement `runLayawayAbandonmentSweep`: find `layaway` orders,
   `status='pending_payment'`, `amount_paid_ngn>0` (or per policy =0),
   `created_at < now() - layaway_abandonment_days`, then auto-cancel under
   the standard cancellation policy (release reservation; apply restocking
   fee). Schedule daily 02:00 (cron wiring already scaffolded).
4. Implement `runLayawayReminders`: due orders → emit Smartcomm reminder
   with running balance + pay-link (`public_tracking_token`). Pause when
   paid. Cadence from config.

**Verify.** Unit-test the three branches (layaway full-pay, deposit-met
flip, abandonment cancel) with a fake clock; assert stock reservation and
GL effects. No double stock-deduction on deposit_triggered.

---

## W-6 — Cash Request module (6.32) · ~2 days

**Goal.** Replace the generic CRUD skeleton with the real 4-stage
workflow. The schema (`migrations/000100_shared_cash_request.sql`) is
complete and rich; only the service logic is missing.

**Schema recap (already built).** `shared.cash_requests` with `business`
discriminator; statuses `draft → pending_finance → pending_ceo → approved
→ disbursed → settled` (+ `rejected/cancelled`); `bank_transaction_id`
mandatory at `disbursed` (trigger-enforced); `linked_journal_entry_id`
soft-FK to `{brand}.journal_entries`; `match_status` pill for bank rec;
`amount_threshold` decides CEO routing.

**Files.**

- `src/modules/cash_request/cash-request.service.js` — add transitions.
- `cash-request.repo.js` — add status-transition updates + business filter.
- `cash-request.routes.js` / `.controller.js` / `.validator.js` — add the
  workflow endpoints.

**Steps.**

1. Routes: `submit`, `finance-decision` (approve/reject/send-back),
   `ceo-decision`, `disburse`, `settle`, `cancel` — mirror the
   expenses-advance route shape (`expenses.routes.js` is the closest
   precedent).
2. `submit`: `draft → pending_finance`.
3. `financeDecision`: if amount ≥ `business_config` threshold →
   `pending_ceo`; else → `approved`. Record `finance_decision`.
4. `ceoDecision`: `pending_ceo → approved | rejected`.
5. `disburse`: require `bank_transaction_id` (app-level guard in addition
   to the DB trigger); set `disbursed_*`; **post GL** via
   `accounting.postEntry` (DR expense/advance, CR cash) and store
   `linked_journal_entry_id`; **auto-create an Expense** in the expenses
   module (PRD §6.7: "once disbursed it lands here as an Expense"); emit
   `cash_request.disbursed`.
6. `settle` (cash advances): reconcile spend vs returned change →
   `settled`.
7. Bank-rec hook: expose by `bank_transaction_id` so accounting's bank
   reconciliation can match (`match_status`).

**Verify.** Walk a request above and below threshold; assert routing,
mandatory-txn-id rejection, the GL journal balances, and the auto-Expense
appears. Confirm `business` filter isolates brands on the shared table.

---

## W-2 — Invoicing dual-currency (6.5) · ~0.5 day

**Goal.** Populate the multi-currency columns the schema already has
(`invoices.display_currency`, `fx_rate_used` — migration
`template/000021`). Today `invoicing.repo.js` writes NGN-only.

**Files.** `src/modules/invoicing/invoicing.repo.js` (INSERT column list,
line ~80), `invoicing.service.js`, `invoicing.subscribers.js` (carry
currency from the source sales order, which already has `display_currency`).

**Steps.**

1. Add `display_currency` + `fx_rate_used` to the invoice INSERT columns.
2. On auto-invoice from `order.paid`, copy the order's `display_currency` /
   `fx_rate_used`.
3. Compute + return display-currency amounts in `getById` (NGN ÷ rate) for
   the detail view.

**Verify.** Create a USD storefront order → invoice shows USD display +
NGN settlement + rate.

---

## W-3 — Cash Flow statement (6.6) · ~1 day

**Goal.** Add the third financial statement (PRD lists P&L + Balance Sheet

- Cash Flow; only the first two exist).

**Files.** `accounting.service.js` (add `cashFlow()` next to
`balanceSheet`), `accounting.controller.js`, `accounting.routes.js`
(`GET /reports/cash-flow`), `accounting.repo.js` (a cash-account movement
query).

**Decision to confirm.** Indirect method (net profit + adjustments) is the
standard but heavier. **Recommended MVP:** direct method off cash/bank
account movements — sum journal-line deltas on accounts in the Cash &
Cash-Equivalents group over the period, grouped into operating / investing
/ financing by the counter-account's group_type. Reuses the existing
`accountActivity` repo pattern.

**Verify.** Cash-flow closing balance ties to the change in cash accounts
on the balance sheet between two dates.

---

## W-4 — AR/AP ageing report (6.6) · ~1 day

**Goal.** Real ageing buckets (0–30 / 31–60 / 61–90 / 90+) off the **live
balance due**, per PRD §6.5 ("ages on its remaining 30%"). Today only an
`overdue` boolean filter exists in invoicing.

**Files.** `accounting.service.js` (`receivablesAgeing`,
`payablesAgeing`), `accounting.repo.js` (cross-schema reads of
`{brand}.invoices` for AR and `{brand}.supplier_invoices` for AP),
`accounting.routes.js` (`/reports/ar-ageing`, `/reports/ap-ageing`).

**Steps.**

1. AR: `total_ngn − amount_paid_ngn` as balance; bucket by
   `now() − issue_date` (or due_date); group by customer.
2. AP: same off `supplier_invoices`; group by supplier.
3. Totals per bucket + grand total reconcile to AR/AP control accounts.

**Verify.** A 70%-paid invoice ages only its 30% remainder; bucket totals
sum to the GL AR balance.

---

## W-5 — Multi-currency gain/loss (6.6) · ~1 day · depends on W-2

**Goal.** Auto-post FX gain/loss when a foreign-currency receivable settles
at a rate different from the booked rate.

**Files.** sales/invoicing payment path (`sales.service.js addPayment`,
invoicing payment), `accounting.service.js` (a `postFxGainLoss` helper +
dedicated GL accounts — the COA seed already splits accounts; confirm a
"Realised FX Gain/Loss" account exists, add if not).

**Steps.**

1. On a payment in a non-NGN currency, compare payment-date rate to the
   order/invoice `fx_rate_used`.
2. Post the delta to Realised FX Gain (CR) or Loss (DR) against cash.

**Verify.** Pay a USD invoice at a moved rate → a balancing FX gain/loss
journal posts; books stay balanced.

---

## Cross-cutting

- **Doc hygiene (cheap):** while in finance, refresh the stale
  migration/table counts in `SCHEMA.md` + `README.md` (run
  `npm run db:verify`).
- **Tests:** each item ships with jest coverage; the repo already has
  `jest.config.js` and a `tests/` tree.
- **Audit:** every new state transition must insert a `shared.audit_log`
  row (pattern already used throughout).

**Total P1 estimate:** ~7.5 engineer-days.
