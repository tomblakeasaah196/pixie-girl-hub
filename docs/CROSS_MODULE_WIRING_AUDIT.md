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

| Gap | Status           | What landed                                                                                                                                                                                                                                    |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1 | ✅ closed        | `order.deposit_met` → `production.subscribers` opens a styling service job.                                                                                                                                                                    |
| G-2 | ✅ closed        | `logistics.subscribers` on `order.paid` auto-creates a dispatch delivery (default courier, order items + address).                                                                                                                             |
| G-3 | ✅ closed        | `commission.subscribers` on `order.paid` → `payroll.accrueForOrder` resolves the rep + rule and accrues commission (channel-mapped, idempotent).                                                                                               |
| G-5 | ✅ closed (core) | Production module built: runs (open/advance/cost/units/receive→`production_in` to Stock) + service jobs (create/advance) over §6.24 schema; cost roll-up via the existing trigger. Landed-cost breakdown / chemical recipes / rework deferred. |
| G-6 | ✅ closed (core) | Intercompany module built: record cross-brand trade → mirrored GL in both ledgers (1210/4050 seller, 5060/2010 buyer) → match → settle → reconciliation; GL failures flagged as discrepancies.                                                 |
| G-4 | ⏳ deferred      | Needs the Smartcomm dispatch connector (WhatsApp/email send).                                                                                                                                                                                  |
| G-7 | ⏳ deferred      | Needs the delivery-letter PDF render at packing.                                                                                                                                                                                               |

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
