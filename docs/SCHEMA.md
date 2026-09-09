# Database Schema

Three schemas:

```
shared                    cross-brand reference, identity, contacts, intercompany, audit, AI
pixiegirl                 PXG brand data
faitlynhair               FLH brand data
```

The authoritative table counts live in `scripts/verify-schema.js`
(`EXPECTED_SHARED` / `EXPECTED_PER_BRAND`) and are asserted by
`npm run db:verify`. They are kept there rather than in prose because every
migration that adds a table has to update them in the same PR — a figure
repeated across several docs simply goes stale, which is what happened to the
"425 / 438" numbers still quoted elsewhere in this repo.

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
npm run db:verify                      # asserts the per-schema table counts
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

## Order amendments (per-brand, template/000093 + migration 000379)

`<brand>.sales_order_amendments` is the audit spine for **Change Order** — amending
an order's items, quantities, prices or delivery details after it was placed (and
possibly paid). One row per change, holding the full before/after of the money and
the lines, a normalised `line_changes` list, the delivery snapshots, and an
`effects` JSONB recording exactly which downstream effects were applied (stock
movements, GL delta journal, invoice revision, Studio jobs cancelled, delivery
re-synced, customer message sent).

Lines are snapshotted as JSONB rather than kept as rows: an amendment **replaces**
`sales_order_lines` (removed lines are deleted so invoices, picklists, Studio and
Logistics all read the truth), so the only durable record of what the order used to
be lives here. Everything that references a line does so `ON DELETE SET NULL`, except
`sales_order_discounts.applied_to_line_id`, which CASCADEs — a per-line campaign
discount correctly dies with its line.

`sales_orders` also carries `amendment_count` + `last_amended_at`, denormalised so
the Orders register can badge a changed order without a join.

See `ORDER_AMENDMENTS.md` for the full mechanism.

## Employee documents (shared, migration 000382)

`shared.hr_document_types` is the **per-brand catalogue** of employee document
types — Employment Contract, Guarantor Form, NIN Slip, Passport Photograph and
whatever HR adds later. It is the only new table: the files themselves are
ordinary `shared.documents` rows, distinguished by

    reference_type = 'staff_profile'
    reference_id   = staff_profiles.profile_id
    document_type  = hr_document_types.type_key

so storage, size, mime type, SHA-256 content hash, uploader and soft-delete all
come from the existing file registry rather than a parallel one.

`type_key` is a stable slug and is **never** updated — it is written into
`shared.documents.document_type`, which is immutable after insert, so renaming
`label` is what relabels every document already filed under a type. For the same
reason a type that is seeded (`is_system`) or already in use is **archived**
(`is_active = false`) rather than deleted; only an unused custom type is removed
outright. `is_required` drives the "missing documents" checklist on an
employee's Documents tab, and `accepts` (`any` | `pdf` | `image`) is enforced
server-side at upload, not just by the file picker.

**These rows are fenced off from the Documents module.** A NIN slip or a signed
contract identifies a person and their pay, and the `documents` permission is
granted far more widely than `hr_payroll` — so `documents.repo.findAll`,
`getById`, `download`, `remove` and the global-search document entity all
exclude `reference_type = 'staff_profile'`, and the files are served only by the
HR-gated routes under `/hr` (plus `/hr/me/documents`, where the profile is
resolved from the token rather than the URL). Downloads are written to
`audit_log` as sensitive accesses; previews are not.

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
