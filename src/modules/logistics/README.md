# Logistics module

**Spec:** Logistics & Delivery (V2.2 §6.10)
**Permission key:** `logistics`

## Backing tables

- `couriers`
- `deliveries`
- `delivery_attempts`
- `delivery_proofs`
- `pay_on_delivery_collections`

## Files

| File                       | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `logistics.routes.js`      | Express router — URL → controller              |
| `logistics.controller.js`  | HTTP handlers (req/res only)                   |
| `logistics.service.js`     | Business logic, transactions, events           |
| `logistics.repo.js`        | Parameterised SQL only                         |
| `logistics.validator.js`   | Zod input schemas                              |
| `logistics.events.js`      | Domain events for realtime + AI                |
| `delivery-comms.service.js`| Customer notices + the per-delivery send ledger |

## What the customer hears, and when

Two distinct messages, deliberately separate, both toggleable from
**Communications Studio** (`shared.outbound_channel_policy`):

| Trigger                          | Automation        | Says                                                             |
| -------------------------------- | ----------------- | ---------------------------------------------------------------- |
| Book delivery (`queued → booked`) | `delivery_booked` | "A courier is assigned" — shipper, waybill/AWB, pickup + ETA window, rider contact, tracking link |
| `picked_up`                       | `order_shipped`   | "The courier physically has it" (fired via `sales/order-comms`)   |
| `out_for_delivery`                | `out_for_delivery`| "Coming today"                                                    |
| `delivered`                       | —                 | Delivered-confirmation email (`sendDeliveredEmail`)              |
| `attempted_failed`                | `delivery_failed` | "We missed you — reschedule"                                     |

`delivery_booked` fires **after the booking transaction commits**, so a comms
failure can never roll a booking back. It is idempotent per delivery
(`dedup_key = delivery_booked:<delivery_id>`); the manual resend claims a fresh
slot on purpose, because the reason staff press it is a typo'd waybill.

Book silently with `notify_customer: false`.

## "Was it sent, did it land, did she open it?"

Every attempt is written to `shared.outbound_comms_log` against the delivery
(`reference_type: 'delivery'`) — the same ledger the invoice and receipt
screens read. `GET /deliveries/:id/comms` returns it plus the three stepper
stamps, and the delivery drawer renders them under **Customer updates**.

The stages are honest about what is knowable:

- **sent** — the provider accepted it (SMTP handoff / WhatsApp API 200).
- **delivered** — WhatsApp/IG only, from the provider's own receipt. Plain SMTP
  cannot confirm inbox delivery, so this stays dark on email.
- **opened** — the customer loaded her public tracking link. Stamped once, in
  `trackByToken` (the storefront page polls, so the guard matters). On email
  this is the only truthful read signal, and a send is never quietly upgraded
  into one.

## TODOs

- [ ] Implement repo create/update with real columns
- [ ] Implement validator schemas with actual field definitions
- [ ] Add module-specific endpoints to routes (state transitions, sub-resources)
- [ ] Wire events to Socket.io rooms (see `src/realtime/rooms.js`)
- [ ] Add unit tests in `tests/unit/logistics/`
- [ ] Add integration tests in `tests/integration/logistics/`
