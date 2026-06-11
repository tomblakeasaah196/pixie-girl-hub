# Cross-Module Wiring Audit — end-to-end connection check

**Date:** 2026-06-09. Scope: do the modules (incl. shared) connect end to
end, or are there flows that dead-end? Method: traced every domain event
(`events.emit`), every subscriber (`.on`), and every cross-module service
call.

---

## 1. Connected flows (verified working)

**Event-driven (publish → subscribe):**

| Event                       | Emitter   | Consumer(s)            | Effect                                   |
| --------------------------- | --------- | ---------------------- | ---------------------------------------- |
| `sales order.paid`          | sales     | accounting.subscribers | posts the sale GL journal                |
| `sales order.paid`          | sales     | invoicing.subscribers  | auto-raises the invoice (multi-currency) |
| `sales order.paid`          | sales     | retention.subscribers  | loyalty points + Streak Stars            |
| `catalogue variant.created` | catalogue | stock.subscribers      | seeds the `stock_levels` row (SSOT)      |

**Direct cross-module service calls:**

- sales → stock (deduct/reserve), sales → campaigns.discount (pricing), sales → accounting (FX gain/loss)
- pos → sales, storefront → sales, logistics → sales
- expenses → accounting, invoicing → accounting, cash_request → accounting (+ expenses materialisation)
- purchasing.payables → accounting + stock

**DB-level:** `fn_service_job_create_task` auto-creates a staff task when a
service job is inserted; loyalty/streak state triggers; stock movement → levels.

That core spine (sale → stock + GL + invoice + loyalty) is solid.

---

## 2. Gaps — flows that currently dead-end

| #   | Gap                                              | Detail                                                                                                                                                         | Fix                                                                                                                            |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| G-1 | **`order.deposit_met` has no consumer**          | W-1 emits it when a deposit-triggered order crosses its deposit %, but nothing starts production/service.                                                      | Production/service subscriber (needs G-5).                                                                                     |
| G-2 | **Dispatch orders don't auto-create a delivery** | PRD §6.10: dispatch orders flow into Logistics once paid. `order.paid` has no logistics consumer; `logistics.createDelivery` exists but is never auto-invoked. | New `logistics.subscribers` on `order.paid` (order_type='dispatch').                                                           |
| G-3 | **Sales commission never accrues**               | `hr_payroll.accrueCommission` exists but no `order.paid` consumer calls it; POS/assigned sales never generate commission.                                      | hr_payroll subscriber on `order.paid` using commission_rules.                                                                  |
| G-4 | **Reminders/notifications not dispatched**       | layaway-reminders emits `order.payment_reminder`; install-hub/Smartcomm CTAs; nothing consumes → no message sent. Smartcomm is a skeleton.                     | Smartcomm dispatch subscriber (or notifications.service fan-out).                                                              |
| G-5 | **Production module is a skeleton**              | Generic create/update/archive only (349 lines). Not wired to stock (`production_in` finished-goods), deposit-met, landed cost, or service jobs.                | Build production service over `production_runs/run_units/cost_components/landed_cost_breakdown/service_jobs/chemical_recipes`. |
| G-6 | **Intercompany module is a skeleton**            | Generic CRUD events; `shared.intercompany_transactions` + per-brand GL not wired. No inter-brand transfer → dual-book flow.                                    | Build intercompany service: record IC txn → post mirrored GL in both brands → reconciliation.                                  |
| G-7 | **Delivery letter not auto-generated**           | B-8 schema (`delivery_letter_templates/renders`) exists; nothing renders at packing.                                                                           | Render on delivery 'packing' transition → Documents.                                                                           |

Severity: G-2/G-3 are small subscriber additions on the existing spine. G-5/
G-6 are module builds. G-1 depends on G-5. G-4/G-7 depend on Smartcomm/PDF.

---

## Status update — 2026-06-09 (this phase)

| Gap | Status                        | What landed                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1 | ✅ closed                     | `order.deposit_met` → `production.subscribers` opens a styling service job.                                                                                                                                                                                                                                                                                                       |
| G-2 | ✅ closed                     | `logistics.subscribers` on `order.paid` auto-creates a dispatch delivery (default courier, order items + address).                                                                                                                                                                                                                                                                |
| G-3 | ✅ closed                     | `commission.subscribers` on `order.paid` → `payroll.accrueForOrder` resolves the rep + rule and accrues commission (channel-mapped, idempotent).                                                                                                                                                                                                                                  |
| G-5 | ✅ closed (core)              | Production module built: runs (open/advance/cost/units/receive→`production_in` to Stock) + service jobs (create/advance) over §6.24 schema; cost roll-up via the existing trigger. Landed-cost breakdown / chemical recipes / rework deferred.                                                                                                                                    |
| G-6 | ✅ closed (core)              | Intercompany module built: record cross-brand trade → mirrored GL in both ledgers (1210/4050 seller, 5060/2010 buyer) → match → settle → reconciliation; GL failures flagged as discrepancies.                                                                                                                                                                                    |
| G-4 | ✅ closed (core) — 2026-06-09 | Smartcomm dispatch built: `order.payment_reminder` → `smartcomm.sendToCustomer` (WhatsApp via provider, recorded on the customer thread). Notifications backbone fixed (the service was inserting columns that don't exist) + shared read API (`/api/v1/notifications`) + `order.paid` → salesperson fan-out. Staff role-routing (approvals→approver) is the remaining extension. |
| G-7 | ⏳ deferred                   | Needs the delivery-letter PDF render at packing.                                                                                                                                                                                                                                                                                                                                  |

Also delivered this phase: **Contacts 360** (`GET /contacts/:id/timeline` +
`/summary`).

The end-to-end spine is now connected: a paid order fans out to GL, invoice,
loyalty/stars, commission, and (dispatch) a delivery; a deposit-triggered
order opens production; finished goods return to Stock; cross-brand trades
post mirrored books. Remaining dead-ends (G-4, G-7) are external-dependency
integrations, not wiring gaps.

---

## 3. Build plan (this phase)

1. **Quick connections** (small, high-value, on the existing spine):
   - G-2 logistics `order.paid` → auto-create dispatch delivery.
   - G-3 hr_payroll `order.paid` → accrue commission.
2. **Production module (G-5 + G-1):** production runs (cost_components roll-up
   via existing trigger), service jobs (status machine; task auto-created by
   trigger), and an `order.deposit_met` + `order.paid`(custom) subscriber that
   opens a production run / service job. Finished units post `production_in`
   to stock.
3. **Intercompany module (G-6):** record an IC transaction, post the mirrored
   journals in both brand ledgers via `accounting.postEntry`, expose
   reconciliation.
4. **Deferred (need external/credentials):** G-4 Smartcomm dispatch (WhatsApp/
   email send), G-7 delivery-letter PDF rendering.

Contacts 360 (this phase, done): `GET /contacts/:id/timeline` + `/summary`
aggregate every record across sales, quotations, invoices, receipts, POS,
CRM, service jobs, deliveries, hair-quiz, loyalty, referrals, reviews.

---

## 4. Comms batch — 2026-06-09 (§6.14–6.17 + shared notifications)

The communications cluster is built and wired into the spine; each module
connects outward rather than living in a silo.

| Module                      | New connection into system flow                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notifications** (shared)  | `order.paid` → salesperson fan-out; shared read API `/api/v1/notifications`. Backbone schema fixed. Closes G-4 core.                                            |
| **Smartcomm** (§6.17)       | `order.payment_reminder` → `sendToCustomer` (WhatsApp/email, recorded on the customer thread). Owns shared message_channels/messages ("messaging" baked in).    |
| **Email Campaigns** (§6.16) | Recipients built **from CRM contacts**; send via `email.service`; events tracked. Public **newsletter** subscribe → creates a CRM contact (`source='website'`). |
| **Social Media** (§6.14)    | Inbound DM → `smartcomm.recordInboundFromCustomer` → bridged onto the customer's thread, linked to their contact (§6.1). Posts/metrics + connected accounts.    |
| **Marketing** (§6.15)       | **Attribution report** joins `ad_spend_daily` to per-brand `sales_orders.utm_campaign` (matched on campaign name) → ROAS. Ad spend ties back to real revenue.   |

Mounts: `/api/v1/notifications`, `/api/v1/smartcomm`, `/api/v1/email-campaigns`,
`/api/v1/social`, `/api/v1/marketing`; public `/api/public/newsletter`.

No new dead-ends introduced: every comms module either consumes a domain
event (notifications, smartcomm), feeds another module (social → smartcomm,
newsletter → CRM), or reads the sales spine (marketing attribution). G-4 is
fully closed at the core; remaining extension is broader role-routing of
notifications (e.g. approvals → approver) and the G-7 delivery-letter PDF.

---

## 5. Pricing + Stylist batch — 2026-06-09 (§6.25, §6.26)

| Module                        | New connection into system flow                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pricing Engine** (§6.25)    | `approveProposal` **writes back** `product_variants.price_*_ngn` (+ `min_price_ngn`) and appends `price_history`, so the **sales spine immediately prices new orders** at the approved number. `getEffectivePrice` is the resolver (override → list → floor clamp → charm rounding) storefront/POS/sales can call. Goal-seek + sensitivity scenarios; revert restores prior prices. |
| **Stylist Programme** (§6.26) | Production `service_job.created` → `stylist.subscribers` opens a routing **assignment**; on `acceptOffer` the chosen stylist is **written back to `service_jobs.assigned_stylist_id`** (per-brand). Completed assignments roll into **payout batches**. Separate **portal JWT** class (not staff); public **badge verify**.                                                         |

Mounts: `/api/v1/pricing`, `/api/v1/stylists` (admin, staff auth),
`/api/v1/stylist-portal` (stylist JWT), public `/api/public/stylist-verify`.

Connections, not silos: pricing approvals feed the variant price columns sales
already reads; the stylist router consumes a production event and writes the
assignment back onto the originating service_job. Both modules validated against
schema/PRD/admin_ui; strict equality throughout. (Note: the WSL bash mount was
stale during this build — the file tools, which are authoritative for the host
workspace, confirmed every write landed complete.)

---

## 6. Service Jobs split + Shared-ops batch — 2026-06-10 (§6.24, §6.18, §6.19, audit, §6.29)

**Service Jobs split into its own module.** service_jobs (service_types + jobs
lifecycle) was extracted from Production into `src/modules/service_jobs` and is
now the canonical owner. The `order.deposit_met → open service job` subscriber
moved with it (`service-jobs.subscribers`), Production was stripped of all
service-job code (routes/controller/service/repo/validator), and the Stylist
subscriber was repointed from `production.events service_job.created` to
`service_jobs.events created`. The DB trigger still auto-raises a staff task on
job insert.

| Module                      | Connection into system flow                                                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service Jobs** (§6.24)    | Owns service_types + service_jobs. `order.deposit_met` → opens a job; job insert → staff task (trigger); `service_jobs.created` → Stylist routing assignment.                                                                                                                                      |
| **Calendar** (§6.18)        | One shared calendar per business; events reference other modules' dated records (service booking, stylist assignment, delivery, deal) via reference_type/id. `createForReference` hook.                                                                                                            |
| **Tasks** (§6.19)           | Shared tasks (manual + trigger-raised). Assigning a task **notifies the assignee** via `notifications.notify`. Subtasks, status board, reference back-links.                                                                                                                                       |
| **Audit** (read API)        | Read-only over `shared.audit_log` (writes via the audit() middleware): list/filter, single entry, and full per-record trail. Business-scoped.                                                                                                                                                      |
| **Retail Partners** (§6.29) | Consignment wholesale. `dispatch_to_partner` / `recall_to_warehouse` also post the **warehouse** stock movement (`stock.recordMovement` → consignment_out/return). Partner = shared.contact (Contacts 360). Settlement splits proceeds by margin_share_pct; settlement carries an invoice_id hook. |

Mounts: `/api/v1/service-jobs`, `/api/v1/calendar`, `/api/v1/tasks`,
`/api/v1/audit`, `/api/v1/retail-partners`.

Verified host-authoritative (Grep/Read, not the stale bash mount): no
non-strict equality, controller/validator/route export parity, all mounts
present, every cross-module call resolves (`notifications.notify`,
`stock.recordMovement`, `service_jobs.events`, service-jobs subscriber).

---

## 7. Comms/shared gap-fill — 2026-06-10 (depth pass vs another impl)

Prompted by a comparison against another implementation's function lists, the
comms-cluster + shared modules were audited against the actual schema and the
schema-warranted gaps were filled. (Functions in the other impl that our schema
does NOT back — message reactions, thread assign/resolve — were deliberately
left out.)

| Module                    | Added (all schema-backed)                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Smartcomm / Messaging** | Full team surface over the existing tables: `createChannel` (group/direct, creator = admin member), `archiveChannel` (is_archived), `add`/`removeMember` (channel_members), `markRead` + `getUnreadCount` (message_reads + last_read_at), `deleteMessage` (is_deleted, author-only), paginated `listMessages`, `addAttachment` (message_attachments).  |
| **Email Campaigns**       | A/B `createVariant` + `getAbTestResults` + `declareWinner` (email_campaign_variants); `schedule` + a per-minute `email-campaign-send` cron; `getStats`; saved segments over `shared.contact_segments` (save/list/get/delete/preview/build); **public tracking** `trackOpen` (1×1 pixel) / `trackClick` (302) / `unsubscribe` at `/api/public/email/*`. |
| **Calendar**              | `listForReference`, `removeParticipant`, `findUpcomingForReminders` (window query for a reminder cron), and an enforced `VALID_EVENT_TYPES` enum.                                                                                                                                                                                                      |
| **Tasks**                 | `getBoard` (kanban grouped by status), `deleteSubtask`, and `createFromModule` — the programmatic cross-module task hook (mirrors `calendar.createForReference`), so any module can raise an assigned task.                                                                                                                                            |

New public mount: `/api/public/email` (pixel/click/unsubscribe). New cron:
`email-campaign-send` (every minute → sends due scheduled campaigns).

Verified host-authoritative (Grep): no non-strict equality, handler/validator/
route parity, mounts + cron registered.
