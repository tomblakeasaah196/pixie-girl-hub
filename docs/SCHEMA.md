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

38 document type sequences per brand, e.g.:

- `PXG-INV-0001`, `PXG-SO-0001`, `PXG-PO-0001`, ...
- `FLH-INV-0001`, `FLH-SO-0001`, `FLH-PO-0001`, ...

`shared.staff_profiles.employee_number` (`TEXT NOT NULL UNIQUE`) is allocated the same way at HR onboarding time (`document_type = 'employee'`, e.g. `PXG-EMP-0001`) — it is server-generated and chronological, never client-supplied.

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

## AI Chief of Staff tables (shared)

The Chief of Staff feature (migrations `000320`–`000322`, `000324`–`000327`) is
entirely in the `shared` schema, business-tagged like `tasks`/`calendar_events`.
The authoritative shared table count lives in `scripts/verify-schema.js`
(`EXPECTED_SHARED`, currently **197**).

| Table | Migration | Purpose |
|---|---|---|
| `shared.goals` | 000320 | Top-level objectives; cached `progress_pct` + `health`, `source`, `template_id` |
| `shared.goal_milestones` | 000320 | Ordered milestones (`display_order`) + `depends_on_milestone_id` chain |
| `shared.goal_stakeholders` | 000320 | Users **or** contacts on a goal (XOR CHECK, partial-unique) |
| `shared.workspace_notes` | 000321 | Personal markdown notes, optional goal/milestone link, trigram search |
| `shared.ai_pending_plans` | 000324 | Batch-plan parent for one-tap approval |
| `shared.cos_followups` | 000325 | Accountability state machine (partial-unique: one open per subject/trigger) |
| `shared.cos_nudges` | 000325 | Dedupe + adaptive-timing log (`engaged_at`) |
| `shared.goal_templates` | 000326 | Reusable playbooks (day-offset `structure` JSONB) |
| `shared.cos_settings` | 000327 | Per-user CoS personalisation (name/tone/pronoun/hours/toggles) |

**Link columns (000320):** `shared.tasks` and `shared.calendar_events` each gain
nullable `goal_id` + `milestone_id` (ON DELETE SET NULL) so existing items link
to goals without moving.

**ALTERs (no new table):** `ai_conversations.kind`,
`ai_action_catalogue.surface`, `ai_pending_actions.plan_id/plan_step` (000324);
`notifications.actions` (000325); `goals.template_id` FK +
`ai_knowledge_chunks.source_type` CHECK widened to admit
`cos_goal|cos_milestone|cos_note|cos_decision` (000326).

RAG memory reuses `shared.ai_embeddings` + `shared.ai_knowledge_chunks` — no new
embedding table. See `docs/AI_CHIEF_OF_STAFF.md`.

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
