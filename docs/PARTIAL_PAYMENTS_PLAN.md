# Partial Payments ("Flexi Pay") — Build Plan & Audit Checklist

**Owner decisions captured:** 2026-07-10 working session (Q1–Q25).
**Scope rule:** everything below is IN scope. The preorder fulfilment project
(structural line marker, stock-arrival allocation queue, preorder admin views)
is OUT of scope for these three PRs — it gets its own plan — **except** the
`markPaid` stock-shortfall guard, which is included here because a shortfall
must never block a customer's payment from being recorded.

Every item carries a checkbox. At the end of each PR we audit the PR diff
against its section. Nothing ships outside this list; nothing on this list is
silently dropped.

---

## Decisions (locked)

| # | Decision |
|---|----------|
| D1 | Buyer explicitly picks a **payment plan** at checkout: `full` or `instalment`. Stored on the order (`sales_orders.payment_plan`). Nobody is ever a layaway customer by accident again. |
| D2 | Plan availability, names, terms, and every number are **configuration, not code** — editable per brand in a Sales → Payments admin tab (PR-3). Config lives in `business_config.installment_settings`. |
| D3 | Customer-facing name seeded as **"Flexi Pay"** — renameable per brand in config. |
| D4 | Checkout options: **Pay in full / Pay deposit / Choose amount** (≥ configured minimum). |
| D5 | Minimum first payment: **percentage of order total**, seeded 30%. Top-ups: flat minimum (`min_topup_ngn`, seeded ₦1,000). Final payment may always be the exact balance. |
| D6 | Custom orders: deposit rule is **global config** (seeded 50%), no longer per-product. Per-product `payment_model` columns go **dormant** (kept, unread). |
| D7 | Campaigns: instalments **off by default**, per-campaign toggle (`sales_campaigns.allow_instalments`). |
| D8 | Stock is **reserved at placement for every order** (any plan); released on cancel/expiry; deducted on full payment. |
| D9 | Instalment orders silent for **60 days** (config) auto-cancel; money already paid is forfeited to Other Income (existing policy Q7), flagged for admin review. |
| D10 | **Abandoned checkouts** (₦0 paid): one friendly nudge after ~2h, auto-cancel + stock release after ~48h (both configurable). This sweep also cleans up the existing backlog. |
| D11 | Reminders go **only** to `payment_plan='instalment'` orders with `amount_paid > 0`. The "You've paid ₦0.00" mess becomes structurally impossible. |
| D12 | Balance payments are **customer-initiated** via the permanent no-login `/pay/{token}` page. No auto-debit. |
| D13 | Staff **may record bank-transfer payments** when the config toggle is on: mandatory bank transaction reference + bank name, recorder tracked (`manual_recorded_by`). |
| D14 | Nothing ships below **100% paid**. No exceptions. |
| D15 | Every part-payment triggers an automated receipt (balance + pay link); crossing 50% triggers a milestone message. Both are Comms Studio automations (editable/disable-able). |
| D16 | Payment-settings admin endpoints gated by `requirePermission("sales","approve")` — the existing manager-level action. (A brand-new RBAC action would require widening the schema CHECK + matrix UI vocabulary; consciously avoided.) |
| D17 | Invoices (B2B) expose part-payment in the UI (backend already supports it). |
| D18 | Phone channel stays retired. Subscriptions (services) untouched. |

---

## PR-1 — Backend engine + safety + cleanup (no UI)

### Migrations
- [x] `migrations/template/000078_business_payment_plan.sql.template` (idempotent, re-runnable):
  - [x] `sales_orders.payment_plan TEXT NOT NULL DEFAULT 'full'` + CHECK (`full|instalment`)
  - [x] One-shot backfill (fixed cutoff date): part-paid, unfinished orders → `instalment`; ₦0-paid stay `full`
  - [x] `sales_campaigns.allow_instalments BOOLEAN NOT NULL DEFAULT false`
  - [x] Partial index for the reminder/abandonment sweeps on `payment_plan='instalment'`
- [x] `migrations/000315_shared_flexi_pay.sql`:
  - [x] Merge new `installment_settings` default keys into existing rows (existing operator values win)
  - [x] Seed Comms Studio automations per brand: `payment_received`, `payment_milestone`, `abandoned_checkout`

### Configuration (single source of truth)
- [x] `src/modules/sales/payment-settings.service.js` — defaults, `getSettings(brand)`, `updateSettings`, `publicConfig` (checkout-safe shape), plan-policy resolution helpers
- [x] `src/modules/sales/payment-settings.validator.js` — Zod schema for PUT
- [x] `GET/PUT /api/v1/sales/payment-settings` (permission: `sales.approve`) — controller + routes
- [x] Public read: `GET /api/public/pay/config/:brand` (plan name, terms, minimums, channel enablement) for PR-2 checkouts/pay page

### Order creation
- [x] `payment_plan` accepted on `orderCreate` validator (default `full`)
- [x] Instalment gating: channel must be enabled in config; `sales_campaign` channel additionally requires the campaign's `allow_instalments`
- [x] `computeDepositPolicy` becomes config-driven (plan + custom-order rule); per-product `payment_model` no longer read
- [x] `payment_plan` persisted (repo ORDER whitelist)
- [x] Stock reserved at placement for **all** plans (savepoint fallback preserved); release paths broadened (markPaid + cancelOrder release for any plan, tolerant of legacy orders with no reservation)

### Payments
- [x] `addPayment` staff-recorded path: allowed only when `allow_staff_recorded_manual_payments` is on; requires `manual_bank_transaction_id` + `manual_bank_name`; stamps `manual_recorded_by`; GL capture identical (settlement account falls back to bank)
- [x] `paymentCreate` validator: `bank_transfer` method + `staff_recorded` path with conditional requirements
- [x] Repo PAY whitelist: manual fields + `recorded_by` + `notes`
- [x] Minimum enforcement at initiation (`createPaymentLink` + staff-recorded `addPayment`): first payment ≥ `min_first_payment_pct` of total (instalment orders); top-ups ≥ `min_topup_ngn`; exact balance always allowed; full-plan orders always init at full balance
- [x] **`markPaid` stock-shortfall guard**: per-line savepoint around `deductForSale`; shortfall logged + stamped on the order + emitted, payment recording never blocked

### Reminders, abandonment, cleanup
- [x] Reminder eligibility → `payment_plan='instalment' AND amount_paid_ngn > 0` (repo queries + claim)
- [x] Layaway-abandonment sweep → same eligibility (committed-but-stalled only), window from config
- [x] New `abandoned-checkout` scheduler: nudge (~2h, Comms Studio `abandoned_checkout`, dedup) + expire (~48h → cancel + release stock), config-driven, registered in worker
- [x] `scripts/report-pending-unpaid-orders.js` + npm script — review list for the client before/after cleanup

### Comms
- [x] `order.payment_recorded` outbox event emitted from `addPayment` (partial payments)
- [x] `payment-comms.subscribers.js`: part-payment receipt (`payment_received`) + 50% milestone (`payment_milestone`), both carrying balance + permanent pay link; registered in worker

### Pay-link
- [x] `previewByToken` enriched: plan, plan name, terms, totals, payment history, `min_next_payment_ngn`
- [x] Amount validation (minimums) in `createPaymentLink` / public POST

### Docs & tests
- [x] This plan committed as `docs/PARTIAL_PAYMENTS_PLAN.md`
- [x] `docs/openapi.yaml`: payment-settings endpoints, public pay config, `payment_plan` on order create, enriched pay preview
- [x] Unit tests: deposit-policy matrix (config-driven), settings merge/validation, payment validator (staff-recorded refinements), min-next-payment resolution + amount guard. _Abandoned-checkout sweep + markPaid shortfall guard are transaction/SQL-bound — covered by module load smoke + manual verification here; a live-DB integration test is tracked for the smoke suite (not a PR-1 blocker)._

---

## PR-2 — Customer-facing UI

- [ ] Campaign checkout (`apps/landing`): plan picker (only when campaign allows), terms modal (config copy), pass `payment_plan` + first amount; gateway initialised for the chosen amount
- [ ] Campaign checkout API (`campaigns.public.service.js`): accept plan + amount, validate against config, init pay-link accordingly
- [ ] Storefront checkout API (`storefront.service.js`): same; checkout response includes plan/balance summary
- [ ] Public Order Form (`OrderCapturePublic`): plan choice
- [ ] **`/pay/[token]` page** (`apps/landing`): brand-themed; items, progress (paid vs balance), "Pay balance / Pay half / Other amount (≥ min)", payment history, terms, WhatsApp support; gateway redirect + return handling
- [ ] Thank-you pages: balance summary + permanent pay link ("save this link")
- [ ] USD orders: display-currency figures at the order's locked rate on the pay page
- [ ] Tests: checkout stage units updated; pay-page API contract test

## PR-3 — Admin UI + polish

- [ ] Sales module → **"Payments" tab**: every config field (name, terms, percentages, windows, channel toggles, manual-payment toggle, milestone toggle), per brand, permission-gated
- [ ] Order Detail: plan badge, paid/balance progress, custom-amount pay-link, send link via WhatsApp/email, **Record bank transfer** modal (mandatory ref/bank, shows recorder), payments ledger labels
- [ ] Orders list: part-paid filter, balance column, copy-pay-link row action, "cancelled with money paid" flag view
- [ ] Invoicing UI: record payment + `partially_paid` badge + balance surfacing
- [ ] Campaign builder: "Allow Flexi Pay" toggle
- [ ] Quick Sale form: plan picker + first-amount + pay-link at chosen amount
- [ ] Business Setup: raw `installment_settings` JSON editor replaced by a pointer to the new tab
- [ ] Comms Studio: verify the three new automations render/edit correctly; refresh default reminder copy (plan name, no "₦0.00 of…" tone)
- [ ] Tests: lint + build green; component tests where patterns exist

---

## Deploy runbook (after each PR merges)

```bash
npm run db:migrate:shared   # applies 000315 (PR-1)
npm run db:repair           # applies template 000078 to pixiegirl + faitlynhair
# restart API process and worker process
npm run report:pending-unpaid   # optional: review list for the client
```

PR-1 behaviour changes on deploy day: ₦0-paid orders stop receiving reminders
immediately; the abandoned-checkout sweep begins nudging/expiring the backlog
per config.
