# Admin-UI Tier Coverage — Built Modules

Cross-check of the **18 built modules** against `ADMIN_UI_REQUIREMENTS.md`
(Tier 1 = full CRUD, Tier 2 = seeded + editable, Tier 3 = read/action-only).
Updated **2026-06-08** — extended from the original 10 modules to add
purchasing, logistics, pos, business_setup, attendance, hr_payroll,
org_workflow, and access (§ "Coverage added 2026-06-08" below). See
`VERIFICATION_REPORT.md` for the full per-module audit.

Original 10: catalogue, contacts, crm, stock, sales, invoicing, accounting,
expenses, documents, sales-campaigns.

## Tier 1 — full CRUD (tables owned by built modules)

| Table(s)                                                                              | Module          | Endpoints                                                  | Status |
| ------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- | ------ |
| `product_categories`                                                                  | catalogue       | list/get/create/patch/archive                              | ✅     |
| `product_collections` + `_rules` + `_members`                                         | catalogue       | header CRUD + rule + member add/remove                     | ✅     |
| `products` + `product_variants` + `product_images` + `product_videos` + `product_seo` | catalogue       | full product editor, variant CRUD, image/video/seo         | ✅     |
| `product_attribute_values`                                                            | catalogue       | list + upsert + delete                                     | ✅     |
| `product_related`                                                                     | catalogue       | list + add + remove                                        | ✅     |
| `stock_locations`                                                                     | stock           | list/create/patch                                          | ✅     |
| `crm_pipelines` + `crm_pipeline_stages`                                               | crm             | pipelines CRUD + stages CRUD                               | ✅     |
| `expense_categories`                                                                  | expenses        | list/create/patch (soft-delete via `is_active`)            | ✅     |
| `chart_of_accounts`                                                                   | accounting      | list/get/create/patch (no delete with journal lines)       | ✅     |
| `fiscal_periods`                                                                      | accounting      | list/create/close                                          | ✅     |
| `sales_campaigns` + `sales_campaign_products`                                         | sales-campaigns | builder CRUD + 3-state lifecycle                           | ✅     |
| `account_groups`                                                                      | accounting      | list + patch (name/order/active; structural fields locked) | ✅     |

`contacts` / `contact_segments` / `contact_addresses` (not tier-listed by
name but required) have full CRUD. ✅

## Tier 2 — seeded + editable

`chart_of_accounts`, `fiscal_periods`, `expense_categories`,
`stock_locations`, `crm_pipelines`+stages, `account_groups` all seedable and
editable. ✅

## Tier 3 — read / action-only (verified NOT free-CRUDed)

| Table                                              | How it's exposed                                             | OK? |
| -------------------------------------------------- | ------------------------------------------------------------ | --- |
| `stock_levels`                                     | read + valuation report; never written directly              | ✅  |
| `stock_movements`                                  | append-only via `/movements`; corrections via adjustments    | ✅  |
| `journal_entries` / `journal_lines`                | read + manual post + reverse; no edit/delete                 | ✅  |
| `account_balances`                                 | trigger-maintained; reports only                             | ✅  |
| `sales_orders`                                     | read + status (workflow) + cancel; money locked post-payment | ✅  |
| `sales_order_payments`                             | created by `markPaid`; no free edit                          | ✅  |
| `invoices`                                         | issue → void only                                            | ✅  |
| `invoice_payments`                                 | record / reverse only                                        | ✅  |
| `credit_notes`                                     | issue → void; posts reversing GL journal                     | ✅  |
| `receipts`                                         | generated on payment                                         | ✅  |
| `cancellation_requests`                            | submit → review → execute                                    | ✅  |
| `bank_statements` + lines + `bank_reconciliations` | import → match → complete (action-only)                      | ✅  |
| `tax_filings`                                      | create → review → file → pay (state machine; GL on pay)      | ✅  |
| `churn_risk_scores`                                | read-only                                                    | ✅  |
| `signature_audit_events`                           | append-only (hash-chained) + read + verify                   | ✅  |
| `audit_log`                                        | append-only; read via audit module                           | ✅  |

## Gaps / dependencies (actionable)

1. ~~**`bank_accounts` (Tier 1 A, shared)**~~ — ✅ CLOSED. Built in Business Setup
   (`/business-setup/bank-accounts`, masked numbers, single-primary).
2. ~~**`tax_rates` (Tier 1 C, shared)**~~ — ✅ CLOSED. Built in Business Setup
   (`/business-setup/tax-rates`, effective-dated with supersede).
3. **`expense_categories` hard delete** — intentionally omitted; categories are
   FK-referenced by expenses, so deactivation via `is_active` is the correct
   "delete". No action needed.

Everything else in Tier 3 that the built modules touch is correctly
read-only or action-only; no module exposes free edit/delete on immutable
financial, ledger, or audit records.

---

## Coverage added 2026-06-08 (8 more built modules)

### Tier 1 — full CRUD

| Table(s)                                                | Module         | Endpoints                                                             | Status |
| ------------------------------------------------------- | -------------- | --------------------------------------------------------------------- | ------ |
| `suppliers` + `supplier_contacts` + `supplier_products` | purchasing     | 3-tab supplier editor (CRUD + contact add/remove + product link CRUD) | ✅     |
| `couriers`                                              | logistics      | list/create/get/patch with rate-card JSONB                            | ✅     |
| `pos_terminals`                                         | pos            | list/create/get/patch (Nomba id, opening float)                       | ✅     |
| `pos_pin_credentials`                                   | pos            | set + verify PIN (never displays PIN)                                 | ✅     |
| `business_config`                                       | business_setup | one-row edit (`/config`); installment + gateway-fee settings          | ✅     |
| `bank_accounts`                                         | business_setup | CRUD, masked numbers, single-primary                                  | ✅     |
| `tax_rates`                                             | business_setup | CRUD, effective-dated supersede                                       | ✅     |
| `currencies` / `fx_rates`                               | business_setup | list/toggle + FX latest/override                                      | ✅     |
| `custom_field_defs`                                     | business_setup | `/custom-fields` CRUD per entity type                                 | ✅     |
| `document_numbering`                                    | business_setup | list + prefix edit (next_number read-only)                            | ✅     |
| `geofences`                                             | attendance     | `/geofences` CRUD (centre + radius)                                   | ✅     |
| `commission_rules`                                      | hr_payroll     | rule builder CRUD                                                     | ✅     |
| `bonus_rules`                                           | hr_payroll     | CRUD incl. 4.8+ auto-trigger config                                   | ✅     |
| `performance_kpi_definitions`                           | hr_payroll     | CRUD + `weight-summary` (sum-to-100 enforced)                         | ✅     |
| `payroll_deductions`                                    | hr_payroll     | `/deductions` CRUD (PAYE/pension/NHF, effective-dated)                | ✅     |
| `performance_cycles`                                    | hr_payroll     | CRUD (appraisal periods)                                              | ✅     |
| `org_units`                                             | org_workflow   | org-units CRUD at `/` and `/:id` (departments/teams)                  | ✅     |
| `org_positions` + `org_position_dotted_lines`           | org_workflow   | positions CRUD + dotted-line add/remove (deputy, threshold)           | ✅     |
| `roles` + `permissions`                                 | access         | roles CRUD + role-permission matrix + catalog                         | ✅     |
| `workflow_definitions`                                  | org_workflow   | `/workflows` CRUD + approval routing                                  | ✅     |

### Tier 3 — read / action-only (verified NOT free-CRUDed)

| Table                                       | How it's exposed                                                   | OK? |
| ------------------------------------------- | ------------------------------------------------------------------ | --- |
| `purchase_orders` + `po_state_history`      | submit→approve→advance→cancel state machine                        | ✅  |
| `goods_received_notes`                      | create→post (immutable after post)                                 | ✅  |
| `supplier_invoices`                         | create→match→approve→pay→void (3-way match)                        | ✅  |
| `deliveries` + `delivery_attempts`/`proofs` | book→advance + append-only attempts/proofs                         | ✅  |
| `pay_on_delivery_collections`               | collected→reconcile→remit state machine                            | ✅  |
| `pos_transactions` + `pos_payment_splits`   | checkout creates; void via workflow; splits append                 | ✅  |
| `pos_sessions` + `pos_cash_drops`           | open→close→reconcile; cash-drops append                            | ✅  |
| `pos_void_log`                              | append-only                                                        | ✅  |
| `commission_earned` / `bonuses_awarded`     | approve/reverse only                                               | ✅  |
| `payroll_runs` / `payslips`                 | calculate→review→approve→pay→reverse; payslip immutable after paid | ✅  |
| `staff_clock_events`                        | append-only via `/clock`; read via `/events`                       | ✅  |
| `workflow_instances`                        | pending list + act (approve/reject)                                | ✅  |

### Notes / gaps surfaced

1. **"Add a new business"** — `business_config` is one-row-per-brand edit
   only; provisioning a _new_ brand is CLI-only (`bootstrap-business.js`).
   Tracked as W-11 in `CONFORMANCE_GAPS.md`.
2. **Email-signature builder** (Documents §6.13) — not evident. W-12.

All financial/operational records above are correctly state-machine /
action-only — no module exposes free edit/delete on immutable PO, GRN,
supplier-invoice, payroll, delivery, or clock-event records.
