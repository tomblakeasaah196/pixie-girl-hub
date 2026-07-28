# Sales module

**Spec:** Sales & Quotations + Installment Payments (V2.2 §6.2)
**Permission key:** `sales`

## Backing tables

- `sales_orders`
- `sales_order_lines`
- `sales_order_payments`
- `quotations`
- `cancellation_requests`

## Files

| File                  | Purpose                              |
| --------------------- | ------------------------------------ |
| `sales.routes.js`     | Express router — URL → controller    |
| `sales.controller.js` | HTTP handlers (req/res only)         |
| `sales.service.js`    | Business logic, transactions, events |
| `sales.repo.js`       | Parameterised SQL only               |
| `sales.validator.js`  | Zod input schemas                    |
| `sales.events.js`     | Domain events for realtime + AI      |

## Quotation → order conversion

A quotation becomes a sales order in one of two ways.

**Payment-driven (the customer-facing path).** `GET /quotations/:id/pay-link`
mints the quote's `public_pay_token` and returns a `/quote/<token>` URL. The
customer opens it and pays; the gateway checkout carries
`metadata.quotation_id` and **no** `order_id`, because no order exists yet. On
confirmation the webhook calls `sales.service.ensureQuotationOrder()`, which
converts the quote, and the payment is then recorded against the resulting order
by the ordinary `addPayment` rail — so invoicing, GL postings, receipts and
comms all fire exactly as they do for any other sale.

Idempotency matters here, because gateways re-deliver webhooks:

| Case                   | Guard                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Sequential re-delivery | `ensureQuotationOrder` returns the existing `converted_sales_order_id`                   |
| Simultaneous delivery  | `client_idempotency_key = 'quotation:<id>'` + the partial unique index on `sales_orders` |
| Duplicate payment row  | existing dedupe on `provider` + `provider_reference`                                     |

⚠️ **Nomba carries no metadata.** Its checkout API accepts only an
`orderReference`, so a quote paid via Nomba is recovered from the reference
shape `nomba-<quotation_number>-<ts>` (`repo.findQuotationByNumber`). Any change
to `makeReference` or to quotation numbering breaks that recovery path.

**Staff-driven (the order-first fallback).** `POST /quotations/:id/convert`, or
`POST /quotations/:id/accept` with `{ convert: true }`, mints the order
immediately. This is the path for sales settled offline (transfer, cash) and for
deposits — a deposit quote is converted first, then part-paid on the _order's_
pay link, which is what enforces the Flexi Pay minimums. A quote pay-link is
always the full total.

Conversion stamps the link both ways: `quotations.converted_sales_order_id`
forward and `sales_orders.quotation_id` back.

## TODOs

- [ ] Implement repo create/update with real columns
- [ ] Implement validator schemas with actual field definitions
- [ ] Add module-specific endpoints to routes (state transitions, sub-resources)
- [ ] Wire events to Socket.io rooms (see `src/realtime/rooms.js`)
- [ ] Add unit tests in `tests/unit/sales/`
- [ ] Add integration tests in `tests/integration/sales/`
