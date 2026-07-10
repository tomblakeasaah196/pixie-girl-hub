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

- [x] Campaign checkout (`apps/landing/CheckoutClient`): plan picker (only when the campaign enables instalments, surfaced via `payload.flexi_pay`), terms shown inline (config copy), passes `payment_plan`; the gateway is initialised for the deposit. **Initial-checkout picker is Full vs Deposit** — the server charges its exact deposit (computed on the true total incl. delivery) so the two never diverge; free custom-amount selection lives on the `/pay` page (avoids the delivery-fee mismatch of pricing a custom amount before the order total is final). Deliberate, capability preserved.
- [x] Campaign checkout API (`campaigns.public.service.js`): accepts `payment_plan` + optional `first_payment_ngn`, re-validates availability (channel + this campaign's `allow_instalments`) in `createOrder`, inits the pay-link for the first payment, returns `flexi_pay` (plan + permanent pay link) + exposes `flexi_pay` on the landing payload.
- [x] Storefront checkout API (`storefront.service.js`): accepts `payment_plan` + `first_payment_ngn` (defensively parsed — no strict schema), inits pay-link for the deposit, response includes `flexi_pay` plan/balance summary.
- [x] Public Order Form (`OrderCapturePublic` + `order-form` schema/service): plan choice, shown only when the channel enables instalments (fetched from `/pay/config/:brand`).
- [x] **`/pay/[token]` page** (`apps/landing/app/pay/[token]`): brand-themed (server page + `PayClient`); four states (loading / not-found / fully-paid / pay); progress bar (paid vs total), "Pay balance / Pay half / Choose amount (≥ min)", payment history, plan terms, WhatsApp support; gateway redirect + return-poll handling. Gateway callback resolved server-side back to the pay page (no open redirect).
- [x] Thank-you page (`ThankYouClient`): instalment deposit is treated as confirmed (status stays `pending_payment` until settled); "Part-paid" framing, balance card + permanent pay link ("save this link"); Purchase pixel fires with the amount actually charged.
- [x] USD orders: `previewByToken` returns `display_fx_rate` (locked at placement); the pay page renders display-currency figures at that rate; custom amounts convert display→NGN before charging.
- [x] Tests: pay-page API contract test (`pay-preview.test.js`); existing deposit-policy/settings/validator suites still green; both frontends typecheck clean.

## PR-3 — Admin UI + polish

- [x] Sales module → **"Payments" tab** (`PaymentSettingsView`): every config field (name, editable terms list, first-payment %, top-up minimum, custom-order deposit %, abandonment/reminder/nudge/expiry windows, per-channel toggles, manual-payment toggle, milestone/auto-cancel toggles), per brand. View for all `sales.view`; edits gated on `sales.approve` (fields disabled otherwise). Reads/writes `GET/PUT /sales/payment-settings`.
- [x] Order Detail: plan badge (`Flexi Pay`), paid/of-total under the balance ribbon, **Payment options** modal — custom-amount pay-link (defaults to full balance, USD-aware) **and** a **Record bank transfer** form (mandatory bank ref + name, recorder stamped server-side, shown only when the config toggle is on).
- [x] Orders list: **part-paid filter** (backend `part_paid` filter → committed instalment orders with a balance) + existing balance column. _Per-row copy-pay-link consolidated into the Order Detail "Payment options" modal — the admin domain differs from the sales/pay domain, so a per-row permanent-link build was avoided; the capability (copy a pay link) is one click away in the detail._
- [x] Invoicing UI: **already supported** — `useRecordPayment` panel, `partially_paid` badge, "Paid to date" + balance surfacing all pre-exist. No change needed.
- [x] Campaign builder: **"Allow Flexi Pay" toggle** (validator `allow_instalments` on create+update, repo column, admin serializer returns it, builder toggle + dirty-check + save). Activates PR-2's campaign checkout picker.
- [x] Quick Sale form: plan picker (Full / deposit), shown only when the channel enables instalments; instalment charges the snapshotted deposit now, full charges the balance.
- [x] Business Setup: raw `installment_settings` JSON editor replaced by a pointer card linking to Sales → Payments.
- [x] Comms Studio: the three new automations render + edit through the generic Studio list (icons added for `payment_received` / `payment_milestone` / `abandoned_checkout`); default copy was seeded plan-name-aware in PR-1 (no "₦0.00 of…" tone).
- [x] Tests: campaign `allow_instalments` validator test; backend suites green; both apps typecheck + production-build clean; lint clean (pre-existing OrdersView warnings only).

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
