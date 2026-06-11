# System-Wide End-to-End Conformance Audit

**Date:** 2026-06-10. **Method:** static, host-authoritative (Read/Grep over
`C:\pixie-girl\src` — the WSL bash mount is stale and was not trusted). Checks:
strict equality, route mounts, RBAC permission-key coverage, event-graph
wiring (emit ↔ subscribe), subscriber boot-registration, and end-to-end flow
against the Product Description. No runtime/Node execution (per the standing
validation process).

---

## 1. Module inventory & mounts — PASS

All built modules and shared modules expose a router and are mounted in
`src/routes/index.js`:

- **Protected `/api/v1`:** crm, catalogue, sales, pos, storefront, invoicing,
  accounting, expenses, purchasing, stock, logistics, hr, attendance, contacts,
  documents, social, marketing, email-campaigns, smartcomm, calendar, tasks,
  business-setup, sales-campaigns, retention, production, service-jobs, pricing,
  stylists, org, storefront-studio, intercompany, retail-partners, cash-request,
  audit, access, notifications.
- **Public `/api/public`:** catalogue, tracking, order-form, install-hub,
  stylist-verify, referral, hair-quiz, sale, sign, newsletter, **email** (pixel/
  click/unsubscribe).
- **Self-authenticating:** `/api/v1/auth`, `/api/v1/stylist-portal` (stylist JWT),
  `/api/webhooks`.

**Skeletons remaining (the only unbuilt work):** `dashboards` (§6.20),
`ai_insights` (§6.30), `ai_governance` (§6.31), `praxis_ai` (§6.29) — routers
are mounted but repo/service/validator still carry `TODO` stubs. This is the
outstanding **Analytics + AI** batch. (`audit.validator.js` is a harmless unused
stub — the audit API is read-only and uses no body validators.)

## 2. Strict equality — PASS

No non-strict `==`/`!=` operators anywhere in `src` (two matches are a `"!="`
filter-operator string literal in catalogue.validator and a `!=` inside an
accounting error-message template — both non-code).

## 3. RBAC permission keys — PASS

Every `requirePermission(key, …)` key resolves to `access.catalog` MODULES:
accounting, ad_analytics (marketing), ai_governance, ai_insights, attendance,
audit, business_setup, calendar, contacts, crm, dashboards, documents,
email_campaigns, expenses (also reused by cash_request by design), hr_payroll,
intercompany, invoicing, logistics, org_workflow, pos, praxis_ai, pricing,
production, purchasing, retail_partners, retention, sales, sales_campaigns,
service_jobs, settings (access), smartcomm, social, stock, storefront,
storefront_studio, stylist_programme, tasks. Notifications deliberately has no
module gate (a user only ever sees their own feed; auth applied upstream).

## 4. Event graph — PASS (consistent emit ↔ subscribe)

| Event                    | Emitter                | Consumers (all registered at boot)                                                                                                                 |
| ------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order.paid`             | sales.service          | accounting (GL), invoicing (invoice), retention (loyalty/stars), hr commission, logistics (dispatch delivery), notifications (salesperson fan-out) |
| `order.deposit_met`      | sales.service          | service_jobs (open styling job)                                                                                                                    |
| `order.payment_reminder` | layaway-reminders cron | smartcomm (WhatsApp dispatch)                                                                                                                      |
| `variant.created`        | catalogue.service      | stock (seed stock_levels SSOT)                                                                                                                     |
| `service_jobs created`   | service_jobs.service   | stylist_programme (open routing assignment)                                                                                                        |
| `metrics_updated`        | campaigns.analytics    | realtime (socket push)                                                                                                                             |

Subscriber files (11) all register once at boot via a side-effect `require`
in their route/service module — **except** `production.subscribers`, which is an
intentional no-op (the deposit→job connection moved to service_jobs when it was
split out). No subscriber listens to an unemitted event; no critical emit lacks
a consumer. Generic `created` emits (contacts, expenses, cash_request, email/
sales campaigns) fan out to the realtime/`*` channel by design — not dead-ends.

## 5. End-to-end flow vs Product Description — PASS for all built modules

- **Sale spine:** order paid → stock deducted/reserved, GL journal posted,
  invoice raised (dual-currency), loyalty points + Streak Stars, sales
  commission accrued, dispatch delivery created, salesperson notified. ✓
- **Custom/deposit flow:** deposit cleared → service job opened → (customer-
  facing, unassigned) → stylist routing assignment → stylist accepts → written
  back to `service_jobs.assigned_stylist_id`; completed jobs roll into stylist
  payout batches. ✓
- **Pricing → sales:** an approved price proposal writes
  `product_variants.price_*_ngn` (+ floors) and appends `price_history`, so the
  sale spine prices the next order at the approved figure; `getEffectivePrice`
  is the shared resolver. ✓
- **Production → stock:** runs receive finished goods as `production_in`; cost
  rolls up via trigger. ✓
- **Intercompany:** cross-brand trade posts mirrored GL in both ledgers →
  match → settle → reconcile. ✓
- **Consignment (retail partners):** dispatch/recall also posts the warehouse
  stock movement (`consignment_out`/`consignment_return`); settlements split
  proceeds by margin share. ✓
- **Comms:** newsletter signup → CRM contact; inbound social DM → smartcomm
  thread linked to contact; email campaigns send via provider with pixel/click/
  unsubscribe tracking and A/B variants; reminders/notifications dispatched via
  smartcomm + the notifications fan-out. ✓
- **Contacts 360:** unified timeline aggregates sales, quotations, invoices,
  receipts, POS, CRM, service jobs, deliveries, hair-quiz, loyalty, referrals,
  reviews. ✓
- **Cross-module task/calendar hooks:** `tasks.createFromModule` and
  `calendar.createForReference` let any module raise an assigned task or place a
  dated record on the shared calendar; a new service job auto-raises a staff
  task (DB trigger). ✓

## 6. Analytics + AI batch — 2026-06-10 (BUILT; §6.20/6.29/6.30/6.31)

The four AI modules are now built full-stack over the shared `ai_*` schema; the
only deliberately-stubbed part is the live LLM/vendor inference (external-
credential dependent), which has a marked integration point in `src/ai`.

| Module                   | What landed + connection                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI Governance** (6.31) | Feature flags, per-user access grants, encrypted vendor creds (encryption.service), monthly budget periods, append-only usage ledger + live spend meter, action catalogue. Runtime guards `canUseFeature`/`recordUsage` are the hooks every AI call passes through.                              |
| **AI Insights** (6.30)   | Detectors read the live spine and raise idempotent flags: overdue **invoices**, stale **intercompany**, **approval** backlog, anti-pocketing **service-match** (service_jobs ↔ sales). 30-min cron sweep + ack/resolve/dismiss API. `raise()` hook lets any module feed stock/margin/attendance. |
| **Dashboards** (6.20)    | Role KPI overview composes sales + ops aggregates with the **AI Insights open-counts** and the latest **briefing** — the cross-module read connection.                                                                                                                                           |
| **Praxis AI** (6.29)     | Conversations + messages (governance-gated per turn), the **human-in-the-loop pending-action gate** (propose → confirm → execute / reject), run-step trace, and the `ai_enabled` action allowlist. Live orchestration is the `src/ai` runtime's job.                                             |

Mounts: `/api/v1/ai-governance`, `/api/v1/insights`, `/api/v1/dashboards`,
`/api/v1/praxis`. New cron: `ai-insights-sweep` (every 30 min). Verified
host-authoritative (Grep): no non-strict equality, mounts present, all
cross-module exports resolve (`governance.canUseFeature/recordUsage/listActions`,
`insights.summary/runDetectorSweep`, `praxis.listEnabledActions`).

## 7. Open items (not regressions)

- **Live LLM inference** (Praxis replies, insight narration, embeddings) — the
  `src/ai` orchestrator/RAG remains a marked stub pending AI vendor credentials
  configured in AI Control; the data, governance, and approval flows are complete.
- **Stock / margin / attendance insight detectors** — the lifecycle tables +
  `raise()` ingest hook are built; their detector queries await the threshold
  columns (reorder point, geofence distance) being wired from their modules.
- **G-7 delivery-letter PDF** at packing — deferred (external render dep).
- Broader notification role-routing (e.g. approvals → approver) — extension.

**Verdict:** every module and shared module in the Product Description is now
built and connected end-to-end. Remaining work is external-dependency
integration (live LLM, a few insight thresholds, the delivery-letter PDF), not
module wiring.
