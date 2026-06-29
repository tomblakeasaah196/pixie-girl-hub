# Database Schema

**438 tables** across 3 schemas:

```
shared       112 tables   cross-brand reference, identity, contacts, intercompany, audit, AI
pixiegirl    163 tables   PXG brand data
faitlynhair  163 tables   FLH brand data
```

> Retention engine additions (migration 000246 + template 000066): shared gains
> `loyalty_earn_rules`, `loyalty_rewards`, `loyalty_reward_redemptions`,
> `referral_program_settings`, `referral_reward_tiers` (+5). Each brand gains
> `retention_strategies`, `retention_strategy_steps`, `retention_enrollments`,
> `retention_strategy_step_runs` (+4 each).

## Schema-per-business isolation

The two brand schemas are **structurally identical** but **completely separate in data**. Each was generated from the same template, with `{{BUSINESS}}` substituted at bootstrap time. A query against `pixiegirl.sales_orders` cannot accidentally touch `faitlynhair.sales_orders`.

## Cross-schema references

Shared tables (contacts, users, audit_log, intercompany_transactions) are visible to both brands. Where a per-brand table needs to reference a shared row, the FK is hard (`REFERENCES shared.contacts`). Where a shared table needs to reference a per-brand row, the reference is a **soft FK** (a UUID column with no FK constraint) since you can't have one FK pointing at one of two possible tables. A nightly reconciliation job catches orphans.

## Migrations

35 files under `migrations/`:

```
000001..000015         shared schema (15 files, applied once)
template/000016..000035  per-brand templates (20 files, applied per brand)
```

To apply:

```bash
npm run db:migrate:shared              # 15 shared migrations
npm run db:bootstrap:pixiegirl         # creates pixiegirl.* (substitutes templates)
npm run db:bootstrap:faitlynhair       # creates faitlynhair.* (substitutes templates)
npm run db:verify                      # confirms 112 + 163 + 163 = 438 tables
```

See `migrations/CHANGELOG.md` for the full evolution history.

## Document numbering

Every numbered document (invoices, sales orders, etc.) uses `shared.document_numbering` for atomic sequence allocation. The DB function `<brand>.fn_next_document_number('invoice')` does `SELECT FOR UPDATE` → returns the next number → increments — preventing duplicates under concurrency.

37 document type sequences per brand, e.g.:

- `PXG-INV-0001`, `PXG-SO-0001`, `PXG-PO-0001`, ...
- `FLH-INV-0001`, `FLH-SO-0001`, `FLH-PO-0001`, ...

## Triggers (per-brand template/000034)

Critical invariants enforced at the DB level:

| Trigger                                  | Purpose                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| `fn_apply_stock_movement`                | Maintains stock_levels from stock_movements           |
| `fn_journal_entry_balance_check`         | Debits = credits when posting; reject otherwise       |
| `fn_journal_entry_immutable`             | Posted journal entries cannot be modified             |
| `fn_journal_lines_no_change_when_posted` | Lines on a posted entry are read-only                 |
| `fn_invoice_recompute_paid`              | Updates amount_paid_ngn from invoice_payments         |
| `fn_sales_order_recompute_paid`          | Updates amount_paid_ngn from sales_order_payments     |
| `fn_sales_order_log_state`               | Appends to sales_order_state_history on status change |
| `fn_po_log_state`                        | Appends to po_state_history on status change          |
| `fn_delivery_log_state`                  | Appends to delivery_state_history on status change    |
| `fn_production_run_recompute_totals`     | Rolls cost_components up to production_runs           |
| `fn_service_job_create_task`             | Auto-creates staff task on service job assignment     |

## Audit log

`shared.audit_log` captures every state-changing action. The table has:

- **UPDATE/DELETE blocked by trigger** — once written, the row is immutable
- Indexes on `(business, occurred_at)`, `(user_id, occurred_at)`, `(target_type, target_id)`
- Append-only enforcement at the DB level — no app code can erase history

## Conformance status

Schema implements **Pixie Girl Hub Product Description V2.2** with these pending amendments (see `CONFORMANCE_GAPS.md`):

- Module 6.32 Cash Request & Disbursement (not yet built)
- Installment payment model (`payment_model` column + abandonment cron)
- Streak Stars + Hair Quiz tables
- UGC ingestion pipeline (replacing the current video embed model)
- RLS implementation decision pending
- Several smaller mismatches catalogued for the next migration pass
