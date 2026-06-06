# Admin-UI Tier Coverage — Built Modules

Cross-check of the modules built so far (catalogue, contacts, crm, stock,
sales, invoicing, accounting, expenses, documents, sales-campaigns) against
`ADMIN_UI_REQUIREMENTS.md` (Tier 1 = full CRUD, Tier 2 = seeded + editable,
Tier 3 = read/action-only). Date: 2026-06-06.

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
