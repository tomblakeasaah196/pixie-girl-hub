# Pixie Girl Hub — Gap Inventory & Fix Plan

**What this is.** An independent, code-verified inventory of what pixie-girl still _lacks_,
checked against the Product Description (PD v2.2), the schema/migrations, and the admin-UI
requirements — followed by a batched fix plan. `hub-system` is used only as a reference/lookup
model; nothing here is a copy of it. Everything is pixie-native.

**Date:** 2026-06-11. **Method:** static, host-authoritative (Read/Grep/Python census over
`src/` + `migrations/`; the bash mount was used only for read-only scans). No code changed yet.

**Headline numbers (measured, not estimated):**

- **57 of 292 schema tables (~20%) have zero application wiring** — modeled product surface with
  no service behind it.
- **9 background jobs are registered but are empty `// TODO: implement` stubs** — 5 queue
  processors + 4 cron schedulers that silently no-op.
- **4 robustness gaps** carried over from `HUB_VS_PIXIE_DEEP_VERIFICATION.md` (RLS inert is the
  worst).

The existing audit docs (`SYSTEM_FLOW_AUDIT`, `CROSS_MODULE_WIRING_AUDIT`, `CONFORMANCE_GAPS`)
say "everything is built and connected." That is true at the **module-mount and core-spine**
level — but it overstates completeness: the reporting/AI/automation layer and a cluster of
retention/production features are schema-only. This doc is the corrected picture.

---

## Dimension 1 — Correctness & robustness (see `HUB_VS_PIXIE_DEEP_VERIFICATION.md` for evidence)

These are not features; they are ways the built spine can silently lose or leak data. Fix first.

| ID  | Gap                                                | Sev | One-line                                                                                                                                                                                                                             |
| --- | -------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-1 | **RLS enabled but inert**                          | 🔴  | `000200` turns RLS on for 62 tables; the GUC it reads is never set (`withBrand` helper doesn't exist, `transaction()` doesn't set it) → `current_business()` always NULL → every brand's rows pass. Data-layer isolation fails open. |
| R-2 | **Event spine non-atomic / pre-commit / no retry** | 🔴  | `order.paid` etc. emit _inside_ the open tx (`sales.service.js:497`); subscribers read on a clientless pool conn (`accounting.subscribers.js:48`) and silently skip the uncommitted row. No outbox.                                  |
| R-3 | **Inbound webhooks are stubs**                     | 🔴  | every receiver in `business_setup/webhooks.routes.js` is `res.status(200).send()`; no verify/log/enqueue. Paystack/Meta/logistics callbacks are dropped.                                                                             |
| R-4 | **Shutdown / locking / consumer idempotency**      | 🟠  | `server.js` shutdown doesn't await drain + exits 0 on crash; no `SKIP LOCKED` in cron sweeps; no UNIQUE on `journal_entries(source_type,source_id)`.                                                                                 |

---

## Dimension 2 — Background jobs that are registered but do nothing (VERIFIED stubs)

`src/jobs/worker.js` schedules/registers all of these, so they _look_ wired — but the bodies are
`// TODO: implement`. They log and return, marking the job done without doing the work.

### Queue processors (5 stubs)

| Processor                      | Queue             | Consequence                                                                              | PD tie |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------- | ------ |
| `email-processor.js`           | `email-send`      | async email enqueues silently dropped (inline `email.service` works, queue path doesn't) | §6.16  |
| `whatsapp-processor.js`        | `whatsapp-send`   | async WhatsApp enqueues dropped (inline `whatsapp.service` works)                        | §6.17  |
| `webhooks-replay-processor.js` | `webhooks-replay` | the durable side of R-3; nothing reprocesses a logged webhook                            | §6.21  |
| `ai-embed-processor.js`        | `ai-embed`        | no RAG embeddings written → Praxis retrieval has no corpus                               | §6.29  |
| `report-processor.js`          | `report-generate` | no async report/PDF/XLSX generation                                                      | §6.20  |

_Note:_ `media-processor` is the one **real** processor (FFmpeg transcode) — keep as the pattern.

### Cron schedulers (4 stubs)

| Scheduler           | Schedule      | Consequence                                                                                      | PD tie      |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| `fx-rates.js`       | daily 06:00   | FX rates never auto-refresh; multi-currency relies on manual override only                       | §5.2 / §6.4 |
| `low-stock.js`      | 08:00 & 14:00 | **low-stock alerts never fire**                                                                  | §6.9        |
| `weekly-reports.js` | Sat 20:00     | **weekly sales + customer reports never generate** (the "replace the Zoho/Sheet ritual" promise) | §6.30       |
| `ai-briefing.js`    | daily 07:00   | **daily AI briefing never generates**                                                            | §6.30       |

The _real_ crons (keep, don't touch): `email-campaign-send`, `layaway-reminders`,
`layaway-abandonment`, `campaign-state-transition`, `ai-insights-sweep`, `ai-pending-expiry`,
`workflow-timeout`, `ugc-ingest`, `campaign-metrics-rollup`, `brand-registry-refresh`.

---

## Dimension 3 — PD features that are schema-only (no service behind the tables)

Each row = a PD feature whose tables exist in migrations but have **zero** functional code
(verified by table-name census _and_ bare-keyword grep, so dynamic `t(brand,'x')` usage is ruled
out). Grouped by module, with the unused tables.

### Retention & Loyalty (PD §6.23) — the biggest cluster

| Feature                                           | PD §   | Unused tables                                                          | State                                                                 |
| ------------------------------------------------- | ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Wig Subscription Service**                      | 6.23.5 | `subscriptions`, `subscription_plans`, `subscription_billing_attempts` | unbuilt (billing trigger exists, no service/cron)                     |
| **Wig Maintenance Add-On**                        | 6.23.5 | `maintenance_plans`, `maintenance_subscriptions`                       | unbuilt                                                               |
| **Bundle Offers / Package Deals**                 | 6.23.4 | `bundle_offers`, `bundle_offer_products`                               | unbuilt (only campaign-level "bundle" discount exists)                |
| **Coupon code engine**                            | 6.23.2 | `coupons`, `coupon_redemptions`                                        | unbuilt (campaign discounts exist; standalone coupon codes don't)     |
| **Automated Retention Workflows**                 | 6.23   | `retention_workflow_rules`, `retention_workflow_executions`            | unbuilt                                                               |
| **Customer Order Timeline + stage notifications** | 6.23.6 | `order_timeline_events`, `timeline_event_codes`                        | unbuilt (Contacts-360 timeline is a different, read-only aggregation) |

### Storefront / e-commerce (PD §6.4)

| Feature                      | PD § | Unused tables         | State                                     |
| ---------------------------- | ---- | --------------------- | ----------------------------------------- |
| **Persistent shopping cart** | 6.4  | `carts`, `cart_items` | unbuilt (only no-login order-form exists) |
| **Wishlist**                 | 6.4  | `customer_wishlists`  | unbuilt (schema + validator only)         |

### Production & landed cost (PD §6.24)

| Feature                                       | PD § | Unused tables                                                                   | State                                                       |
| --------------------------------------------- | ---- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Landed-cost build-up**                      | 6.24 | `landed_cost_breakdown`                                                         | unbuilt (cost roll-up exists; itemised landed cost doesn't) |
| **Chemical recipes / usage / reconciliation** | 6.24 | `chemical_recipes`, `service_job_chemicals`, `monthly_chemical_reconciliations` | unbuilt                                                     |
| **Rework tracking**                           | 6.24 | `rework_events`                                                                 | unbuilt                                                     |

### HR / Payroll (PD §6.11)

| Feature                           | PD § | Unused tables                               | State                                                                         |
| --------------------------------- | ---- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| **Performance appraisal scoring** | 6.11 | `performance_reviews`, `performance_scores` | unbuilt (KPI _defs_ + cycles have admin CRUD; the scoring/review run doesn't) |
| **Leave management**              | 6.11 | `leave_requests`                            | unbuilt                                                                       |
| **Staff assets / contracts**      | 6.11 | `staff_assets`, `staff_contracts`           | unbuilt                                                                       |

### Accounting & finance (PD §6.6)

| Feature                       | PD §    | Unused tables                                   | State                                                                  |
| ----------------------------- | ------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| **Period-end FX revaluation** | 6.6     | `fx_revaluation_runs`, `fx_revaluation_entries` | unbuilt (realised FX on payment exists; unrealised period-end doesn't) |
| **Invoice reminders**         | 6.5/6.6 | `invoice_reminders`                             | unbuilt (AR ageing exists; auto-reminders don't)                       |
| **Expense approval workflow** | 6.7     | `expense_approvals`                             | unbuilt (expenses post directly)                                       |

### Logistics, dashboards, AI, infra

| Feature                                    | PD §        | Unused tables                                                                        | State                                                      |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Curated Delivery Letter render**         | 6.10        | `delivery_letter_templates`, `delivery_letter_renders`                               | deferred (G-7; needs PDF engine)                           |
| **Saved dashboards / reports persistence** | 6.20/6.30   | `dashboard_configs`, `dashboard_widgets`, `saved_reports`, `report_run_outputs`      | unbuilt (dashboards compose live, don't persist)           |
| **AI RAG corpus**                          | 6.29        | `ai_knowledge_chunks`                                                                | unbuilt (ties to `ai-embed` stub + `rag-pipeline.js` TODO) |
| **Soft-FK reconciliation sweep**           | infra (C-3) | `soft_fk_registry`, `soft_fk_reconciliation_runs`, `soft_fk_reconciliation_findings` | unbuilt (schema shipped, no sweep)                         |
| **Notification preferences**               | 6.x         | `notification_preferences`                                                           | unbuilt (no per-user opt-out/routing)                      |

_Acceptable / not gaps (verified):_ `refresh_tokens`/`user_sessions` (auth handles tokens in code),
`stock_reservations` (handled via `stock_movements` reserve type), `account_balances` /
`sales_order_state_history` (trigger-maintained, read via views), `contact_tags`/`document_tags`,
`crm_deal_*`, `stylist_tier_keys`, `funding_sources`, `tracking_links` — leave unless a screen
needs them.

---

## Dimension 4 — Admin-UI requirements with no backing CRUD

`ADMIN_UI_REQUIREMENTS.md` Tier-1 lists configuration screens the owner must have. These map 1:1
onto the unbuilt config tables above — so the admin-UI gap is the _config_ half of Dimension 3:

- **§E Retention config** — subscription plans, bundle offers, coupon rules, retention-workflow
  rules: no CRUD (tables unwired).
- **§O Production / Service** — chemical recipes, landed-cost components: no CRUD.
- **§S Dashboards & Reports** — report templates / saved reports: no CRUD (only live compose).
- **§P Payroll** — appraisal review screens (scoring): no CRUD (only KPI-def/cycle config exists).

Everything else in Tier-1 (identity, org/roles, custom fields, geofences, catalogue, pricing,
stylist, purchasing, expenses, accounting COA, POS, logistics couriers, AI governance) **does**
have CRUD — `ADMIN_UI_COVERAGE.md` is accurate there.

---

## What is genuinely DONE (don't rebuild)

The core ERP spine is real and connected, verified by reading the code: sales → stock + GL +
invoice + loyalty + commission + dispatch; deposit → service job → stylist routing; pricing
write-back to variant prices; intercompany mirrored books; consignment; POS; purchasing 3-way
match; cash request; storefront order-form; storefront studio; email campaigns (send + tracking +
A/B); social inbound → smartcomm; contacts-360; AI governance/insights data + approval flows;
`decimal.js` money discipline; clean error handler; clean resource singletons. These are not in
scope to redo.

---

## Fix plan — batches (pixie-native; hub only as reference)

Ordered by leverage. Each batch ends with the standard static-validation sweep (strict equality,
route mounts, event-graph wiring, permission-key coverage) + docs/memory update. No `node` runs.

**Batch 0 — Robustness (Dimension 1).** R-1 RLS wiring (`brandTransaction` choke point + migrate
write paths + zero-rows-without-context test) → R-2 transactional outbox (`shared.event_outbox`,
post-commit dispatch via a _real_ `event-dispatch` worker, idempotent consumers) → R-3 webhook
receiver pipeline (verify→log→dedup→enqueue→200) → R-4 shutdown/locking/idempotency. _This is the
existing `SOLIDIFICATION_PLAN.md` scope with R-1 promoted to first._

**Batch 1 — Make the stub jobs real (Dimension 2).** Implement the 5 processors + 4 schedulers.
High value, low surface: `low-stock`, `fx-rates`, `weekly-reports`, `ai-briefing`,
`email-/whatsapp-/webhooks-replay-/ai-embed-/report-` processors. `webhooks-replay-processor`
lands with R-3; `ai-embed`/`report` can be thin first cuts.

**Batch 2 — Retention feature cluster (Dimension 3, §6.23).** Subscriptions + maintenance add-on
(plans → enrol → billing cron over `subscription_billing_attempts`), bundle offers, coupon-code
engine, automated retention workflow rules engine, order-timeline events + stage notifications.
Biggest single block of unbuilt customer-facing value; reuses the loyalty/retention module.

**Batch 3 — Production depth + HR appraisal (§6.24, §6.11).** Landed-cost breakdown, chemical
recipes/usage/reconciliation, rework events; performance-review scoring over the existing KPI
defs/cycles.

**Batch 4 — Finance + storefront completeness.** FX period-end revaluation, invoice reminders,
expense approvals; persistent cart + wishlist; saved dashboards/reports persistence; soft-FK
reconciliation sweep.

**Batch 5 — Deferred / external-dep.** G-7 delivery-letter PDF (needs the headless-browser owner
from `SOLIDIFICATION_PLAN` C-2); Praxis live orchestrator + RAG embeddings (needs AI vendor creds).

**Recommendation:** do **Batch 0 then Batch 1** first — they protect and complete what's already
built (correctness + the silently-dead automation), before adding the larger Batch 2–4 feature
surface.

---

## Doc-hygiene corrections to make alongside

1. `CONFORMANCE_GAPS.md` marks C-1 RLS "done" — reality: enabled but inert (R-1). Re-label.
2. `SYSTEM_FLOW_AUDIT.md` §6 lists §6.20/6.30 as "BUILT" — the _detector sweep_ is built, but
   the **briefing + weekly reports are stubs**. Re-label as data-layer-built / generation-pending.
3. The "use the existing email/whatsapp queues" advice (Solidification B-5) assumes those queues
   work — they're stubs; Batch 1 must implement the processor before B-5 can route through it.
