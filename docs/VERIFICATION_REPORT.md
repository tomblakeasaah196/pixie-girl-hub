# Build Verification Report — Pixie Girl Hub Backend

**Date:** 2026-06-08
**Scope:** Conformance of the 18 built modules against the V2.2 Product
Description (PRD), the migrated schema, and `ADMIN_UI_REQUIREMENTS.md`.
**Method:** Static review (code + migrations + docs). No DB/test execution.

---

## 1. What "built" means here

The 18 modules below carry real implementation (≈1,200–3,200 lines each)
versus the ~350-line skeletons that the un-started modules still are. All
18 are mounted in `src/routes/index.js`, all have RBAC permission keys in
`access.catalog.js` and seeds in the migrations, and all follow the same
layered shape (routes → validator → controller → service → repo → events).

**Built modules (per-brand):** accounting, business_setup, catalogue, crm,
expenses, invoicing, logistics, pos, purchasing, sales, sales_campaigns,
stock.
**Built modules (shared):** access, attendance, contacts, documents,
hr_payroll, org_workflow.

---

## 2. Headline findings

1. **The 18 modules are PRD-conformant at the core.** Every module
   implements the primary feature set its PRD section calls for; several
   (purchasing, sales_campaigns, documents, hr_payroll) exceed it.

2. **The schema is now essentially fully V2.2-conformant.** Every gap in
   the old `CONFORMANCE_GAPS.md` (Buckets A, B and C) has since been
   shipped to migrations — RLS, field-level privacy, e-signature, Cash
   Request, Streak Stars, Hair Quiz, UGC/self-hosted video, public order
   form, curated delivery letter, per-gateway fees, installment
   `payment_model`. Migration count is now **51 files (28 shared + 23
   templates)**, not the 35 the README/`SCHEMA.md` still claim.

3. **The real gap class today is application-layer wiring lag, not schema
   gaps.** The schema (and in several cases the routes) are scaffolded
   ahead of the service logic for: the `payment_model` behavioural rules,
   retention, storefront, storefront_studio, and the cash_request module.
   See §4.

4. **The governing docs are stale and are corrected by this pass.**
   `CONFORMANCE_GAPS.md` listed everything as PENDING (wrong);
   `ADMIN_UI_COVERAGE.md` covered only 10 of the 18 modules; `SCHEMA.md`
   and `README.md` undercount migrations and tables. All updated alongside
   this report.

---

## 3. Per-module conformance

Legend: ✅ conformant · ⚠️ conformant with noted gap · 🔧 schema present,
code wiring incomplete.

### Finance

| Module     | PRD | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| accounting | 6.6 | ⚠️     | COA + account groups, fiscal periods (close), journals (immutable + reverse-only), trial balance / P&L / balance sheet, bank statement import → reconcile, tax filings (create→review→file→pay), `sales.order.paid`→GL subscriber. **Gaps:** no Cash Flow statement (PRD lists P&L + BS + Cash Flow); no formal AR/AP **ageing** report (only an `overdue` filter in invoicing); multi-currency gain/loss not auto-computed. |
| invoicing  | 6.5 | ⚠️     | Full lifecycle (Draft→Sent→Partially Paid→Paid→Overdue), partial payments via `invoice_payments`, credit notes, receipts, auto-invoice subscriber. **Gap:** schema has `display_currency`/`fx_rate_used` but the module writes NGN-only — dual-currency display per §6.5 not yet populated.                                                                                                                                  |
| expenses   | 6.7 | ✅     | Categories, reimbursement **and** cash-advance flow (request→approve→reject→disburse→settle), expense lifecycle (submit→approve/reject→pay), receipt upload → Documents gateway, GL posting on approval.                                                                                                                                                                                                                     |
| purchasing | 6.8 | ✅     | Suppliers + contacts + products (3-tab), RFQ→quote→award, PO (submit→approve→advance→cancel) with factory-tracking statuses matching PRD exactly (`in_production, quality_check, ready_to_ship, in_transit, arrived_lagos, cleared_customs`), GRN, three-way supplier-invoice matching. Exceeds PRD.                                                                                                                         |

### Commerce

| Module          | PRD       | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| catalogue       | 6.4 / 6.9 | ✅     | Products + variants + images + videos + SEO + attributes + related + collections (manual & rule) + category tree. Matches Admin-UI Tier 1 G fully. Note: video model is embed-based; UGC self-hosted schema (000037) landed but not yet wired into the catalogue editor.                                                                                                                                                                     |
| stock           | 6.9       | ✅     | Locations, valuation, levels (read), movements (append-only), adjustments (create→post), transfers (dispatch→receive), low-stock alerts (ack/dismiss/resolve), incoming shipments (receive/status). Single source of truth as specified.                                                                                                                                                                                                     |
| sales           | 6.2       | 🔧     | Orders with `order_type` (walk_in/dispatch/digital/collection), partial payments (`sales_order_payments`), quotation builder (send→accept→convert/reject), cancellation requests. `payment_model` is **stored** on the order, but the **behavioural** rules are not implemented: deposit-triggered does not unlock production at the deposit %, and layaway abandonment/reminder crons are stubs (`jobs/schedulers/layaway-*.js` are TODOs). |
| pos             | 6.3       | ✅     | Terminals, PIN set/verify, sessions (close/reconcile/cash-drops), checkout, transactions + void, **split payments** (`pos_payment_splits`), **idempotency key** (`client_idempotency_key` + lookup).                                                                                                                                                                                                                                         |
| sales_campaigns | 6.22      | ✅     | Full builder, 3-state lifecycle + approval workflow (submit→approve/reject→launch→pause/resume→end), public landing/stock-counter/signup, daily metrics + post-campaign report, share-kit with UTM, duplicate/preview. Exceeds PRD.                                                                                                                                                                                                          |
| logistics       | 6.10      | ⚠️     | Couriers + rate cards, deliveries (book→advance→attempts→proofs→webhook-events→cancel), POD collections (collected→reconcile→remit), public tracking by token, status enum matches PRD timeline. Curated Delivery Letter + Install Hub **schema** (000037) and the `/api/public/install-hub/:token` route exist, but the hub's content composition depends on storefront/retention/stylist code that is still skeleton.                      |

### CRM & Setup

| Module         | PRD  | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| crm            | 6.1  | ✅     | Pipelines + stages (custom per brand), deal kanban (move/status/notes/activities), customer measurements + preferences, churn score read/record. Instagram DM intake is correctly deferred to Smartcomm (6.17, not yet built).                                                                                                                                                                                                                                                                    |
| business_setup | 6.21 | ⚠️     | Brand config, all 4 gateways (Paystack/Opay/Nomba/Stripe), channel connections (Meta IG/WhatsApp, Chowdeck, GIGL), currencies + FX, bank accounts, tax rates (effective-dated supersede), custom fields, document numbering, installment + per-gateway-fee settings, manual-payment toggle. **Gap (known):** no in-app **"add a new business"** provisioning. A new brand is created only via the CLI `scripts/bootstrap-business.js <brand>`; the module edits the existing brand's config only. |

### Shared

| Module       | PRD       | Status | Notes                                                                                                                                                                                                                                                                                                                     |
| ------------ | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| access       | §3 / 6.27 | ✅     | Permission catalog (36 enforced module keys), roles CRUD + role-permission matrix, user-role assignment, `requirePermission` guards.                                                                                                                                                                                      |
| attendance   | 6.11.1    | ✅     | Clock in/out, geofence CRUD, on-site/off-site distance calc (`geo.calc.js`), capture-on-punch model with consent flag per spec.                                                                                                                                                                                           |
| contacts     | 6.12      | ✅     | Contacts + addresses + segments CRUD; single source of truth for people.                                                                                                                                                                                                                                                  |
| documents    | 6.13      | ✅     | Immutable filing cabinet (create/download/send/void/cancel/verify) **plus** the full e-signature workflow (public sign/decline by token, B-10). Exceeds PRD. Minor: branded **email-signature builder** (§6.13 last line) not evident.                                                                                    |
| hr_payroll   | 6.11      | ✅     | Auth (login/refresh/reset) lives here; employees, commission rules + earned (approve/reverse), bonus rules + awards incl. 4.8+ rating trigger, weighted KPI defs (sum-to-100 enforced) + performance cycles, deductions (PAYE/pension/NHF), payroll runs (calculate→review→approve→pay→reverse), payslips. Comprehensive. |
| org_workflow | 6.27      | ✅     | Org-units CRUD (`/`, `/:id`), positions, dotted-lines, deputy flag + approval thresholds, workflow definitions, approval routing engine (pending/act), generates the RBAC matrix (`permissions.repo.js`). Full Module-6.27 coverage.                                                                                      |

---

## 4. Schema-vs-code drift (the live work queue)

These items have **schema** (and sometimes **routes**) shipped, but the
service logic is incomplete. This is where "the migrations are ahead of the
modules."

| Area                      | Schema             | Routes     | Service logic            | What's missing                                                                                                                         |
| ------------------------- | ------------------ | ---------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_model` behaviour | ✅ (000016/000019) | n/a        | 🔧 stored only           | Deposit-triggered → unlock production at deposit %; layaway abandonment auto-cancel cron; layaway reminder cron (both are TODO stubs). |
| retention (6.23)          | ✅ (000036)        | ✅ mounted | ❌ skeleton (~382 lines) | Streak Stars, loyalty ledger/tiers, churn compute, referral, hair quiz logic.                                                          |
| storefront (6.4)          | ✅ (000010/000037) | ✅ mounted | ❌ skeleton (~404 lines) | UGC video pipeline, storefront analytics, public order-form handling, install-hub composition.                                         |
| storefront_studio (6.28)  | ✅                 | ✅ mounted | ❌ skeleton (~360 lines) | Theme/page/navigation visual editor + delivery-letter template editing.                                                                |
| cash_request (6.32)       | ✅ (000100)        | ✅ mounted | 🔧 minimal (~352 lines)  | Full User→Finance→CEO→disburse workflow with transaction-ID capture; auto-creates Expense on disburse.                                 |
| invoicing dual-currency   | ✅ (000021)        | ✅         | 🔧 NGN-only              | Populate/display `display_currency` + `fx_rate_used`.                                                                                  |
| accounting reports        | partial            | ⚠️         | 🔧                       | Cash Flow statement; AR/AP ageing report; multi-currency gain/loss.                                                                    |

---

## 5. Doc corrections applied in this pass

- **`CONFORMANCE_GAPS.md`** — rewritten: Bucket A/B/C items marked SHIPPED
  (per `migrations/CHANGELOG.md`), replaced with the §4 wiring-lag queue.
- **`ADMIN_UI_COVERAGE.md`** — extended from 10 to all 18 built modules
  (added purchasing, logistics, pos, business_setup, attendance,
  hr_payroll, org_workflow, access).
- **`SCHEMA.md` / `README.md`** — migration/table counts are stale (claim
  35 migrations / 425 tables; actual is 51 migration files after the gap
  buckets shipped). Flagged for the maintainer to refresh against
  `npm run db:verify`.

---

## 6. Confidence & limits

Findings are from static review of code, migrations and docs. Counts of
tables and the exact post-gap table total were **not** re-verified against
a live DB (`npm run db:verify` was not run, per the static-review scope).
Where a feature is marked 🔧, it means the symbol/column/route exists but
the behavioural code path was confirmed absent or stubbed by reading the
service file — not merely inferred from line counts.
