# Communications Studio

One CEO-editable place for every automated outbound message the Hub sends.

**Spec:** V2.2 §6.17 (Smartcomm) + PR 2 cost-discipline decisions extended.
**Permission key:** `comms_studio`

## Why it exists

Before this module, six code paths sent automated messages to customers, and
four of them hardcoded strings and called `whatsapp.sendText` directly —
bypassing the outbound_channel_policy matrix. The CEO could set
`layaway_reminder = email` and WhatsApp charges would still land, because
invoice-delivery, receipt-delivery, campaign go-live blasts, and retention
workflows didn't consult policy.

The Studio makes policy authoritative. Every automated send now flows through
`dispatcher.dispatch({brand, event_key, contact_id, variables})`, which:

1. Reads the automation row (channel + templates + cadence) from
   `shared.outbound_channel_policy`.
2. Respects `is_active` (a disabled row is a no-op).
3. Resolves channel via `outbound_policy.resolveChannel` (honours contact
   preference, `block_whatsapp` guardrail).
4. Claims a dedup slot on `shared.automation_send_log` so re-runs of the
   same logical send are silent no-ops.
5. Renders the block-editor JSON into the same brand-skinned HTML the rest
   of the email pipeline emits, then enqueues on the right BullMQ queue.

Nothing in the codebase sends an automated message outside this funnel.

## Backing tables

- `shared.outbound_channel_policy` — one row per `(business, event_key)`,
  extended with `display_name`, `description`, `category`, `trigger_type`,
  `cadence_config`, `subject_template`, `preheader_template`,
  `email_blocks_json`, `whatsapp_body_template`, `instagram_body_template`,
  `variables_schema`.
- `shared.automation_send_log` — idempotency ledger, unique on
  `(business, event_key, dedup_key)`.

Both created / extended by `migrations/000309_shared_comms_studio.sql`, which
also seeds the 16 automations Pixie Girl Hub currently sends.

## Files

| File                             | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `comms-studio.routes.js`         | Express router                                       |
| `comms-studio.controller.js`     | HTTP handlers                                        |
| `comms-studio.service.js`        | Business logic + audit + diagnostics                 |
| `comms-studio.repo.js`           | Parameterised SQL + `automation_send_log` helpers    |
| `comms-studio.validator.js`      | Zod input schemas                                    |
| `dispatcher.js`                  | `dispatch()` — the central send funnel               |
| `renderer.js`                    | Template renderer + block-to-HTML compiler           |

## Endpoints

| Method | Path                                             | Purpose                    |
| ------ | ------------------------------------------------ | -------------------------- |
| GET    | `/api/v1/comms-studio`                           | List automations           |
| GET    | `/api/v1/comms-studio/:event_key`                | Get one                    |
| PUT    | `/api/v1/comms-studio`                           | Update one                 |
| POST   | `/api/v1/comms-studio/preview`                   | Render preview (draft-aware) |
| POST   | `/api/v1/comms-studio/send-test`                 | Send test to a destination |
| GET    | `/api/v1/comms-studio/:event_key/send-log`       | Recent activity            |

## Block editor schema

`email_blocks_json` is an array of blocks; the compiler in `renderer.js`
maps each block type onto a primitive in `services/email-theme.js`.
Supported types: `eyebrow`, `heading`, `paragraph`, `button`, `divider`,
`spacer`, `hero`, `perk`, `price_compare`, `deadline`. Any block field can
contain `{{tokens}}` — substitution runs on the fully-assembled HTML after
the block compiler is done, so token values can even carry HTML.

## Cadence config shapes

| `type` | Fields | Used by |
| ------ | ------ | ------- |
| `event`     | `event`, `offset_days?`, `after_minutes?` | order_confirmation, invoice_issued, delivery_booked, order_shipped, welcome, campaign_launch, review_request, staff_invite, stylist_assignment |
| `scheduled` | `every_min?`, `every_days?`, `quiet_hours_local?`, `min_amount_paid_ngn?` | layaway_reminder, payment_reminder |
| `annual`    | `source`, `hour_local?` | birthday_wish |
| `recurring` | free-form           | (future) |

## Extending

To add a new automation:

1. Insert a row into `shared.outbound_channel_policy` (per brand) — usually
   done in a migration seeding the studio defaults.
2. At the trigger point in the codebase, call
   `commsStudio.dispatch({brand, event_key, contact_id, variables})`.
3. If it's a scheduled or annual automation, add a scheduler in
   `src/jobs/schedulers/` that fans it out; wire in `src/jobs/worker.js`.

The Studio UI picks up new rows automatically — no frontend change needed.
