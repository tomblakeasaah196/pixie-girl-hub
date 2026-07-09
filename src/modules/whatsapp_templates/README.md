# WhatsApp Templates

Authoring, submission, and cost visibility for Meta **message templates**
— the only way to message a customer once the 24-hour customer-care
window has closed.

Mounted at `/api/v1/whatsapp-templates`. Gated by the `messaging_accounts`
permission key (same Messaging settings surface as the WhatsApp/IG/FB/email
key vault) — no new RBAC module.

## Why

Meta blocks free-form WhatsApp replies outside the 24h window. To reach a
customer after that, you send a **pre-approved template**. The inbox used
to tell reps "send an approved template" with nowhere to create or review
them. This module is that place.

## Data

Two per-brand tables (`business` text key, like `shared.messaging_accounts`):

- `shared.whatsapp_templates` — local mirror of each brand's Meta
  templates. A row is authored in the Hub (`LOCAL_DRAFT`), submitted to
  Meta (`PENDING`), then tracks Meta's verdict (`APPROVED` / `REJECTED` /
  `PAUSED` / …). `components` is Meta's raw components JSON;
  `body_text` + `variables` are convenience mirrors.
- `shared.whatsapp_template_rates` — per-brand NGN cost of one send by
  category (`MARKETING` / `UTILITY` / `AUTHENTICATION` / `SERVICE`). The
  UI shows the price next to every template.

## Endpoints

| Method | Path | Perm | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/` | view | List templates (each decorated with its send `cost`) + rates |
| POST | `/sync` | edit | Pull every template from Meta and reconcile the mirror |
| POST | `/` | create | Author a template; `submit:true` pushes to Meta for review |
| PATCH | `/:id` | edit | Edit category/components; `submit:true` re-submits to Meta |
| POST | `/:id/submit` | edit | Submit (or resubmit) a local draft to Meta |
| DELETE | `/:id` | delete | Remove on Meta (if present) + the local mirror |
| GET | `/rates` | view | List the per-category send-cost rates |
| PUT | `/rates` | edit | Upsert one category's rate |

## Meta integration

The Graph calls live in `src/services/whatsapp.service.js`
(`listTemplates` / `createTemplate` / `editTemplate` / `deleteTemplate`).
They operate on the **WhatsApp Business Account (WABA)** node, so the
brand's `business_account_id` must be set under Messaging Accounts —
resolved (decrypted) via `resolveWhatsAppSendConfig`.

Meta failures are surfaced with the provider's own `error_user_msg`.
Creating/editing is best-effort against Meta but always mirrored locally,
so a draft is never lost if submission fails.
