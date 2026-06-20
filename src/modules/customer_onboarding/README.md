# Customer Onboarding

The "Online QR" / shareable welcome form.

**Spec:** Pixie Girl Hub V2.2 §6.17 (Smartcomm — Online QR companion to
the in-store Walk-in QR)
**Permission key:** `customer_onboarding` (admin paths only — the form
submission endpoint is public, token-protected)

## Why it exists

70% of revenue arrives from Instagram / WhatsApp DMs. Asking a brand-new
customer "what's your delivery address" is a multi-message conversation
that loses sales. This module turns that exchange into one shareable
link.

A staff member taps **"Send Online QR"** in the Smartcomm composer, we
mint a token bound to that thread, and the customer opens
`/welcome/{business}/{token}` on their phone. They fill name + DOB +
phone + IG handle + WhatsApp number + email + delivery address (Google
Places autocomplete, NG-restricted, with a map pin and lat/lng) + any
inspiration photos. On submit:

1. The matching contact is found or created.
2. `contact_social_handles` is upserted for IG + WhatsApp.
3. A default `contact_addresses` row is created/updated with lat/lng.
4. The originating Smartcomm channel (if any) is updated so the
   staffer sees a "form completed" chip in the customer sidebar.

## Backing tables

- `shared.customer_onboarding_submissions` — tokens + payloads + status
- `shared.contacts` — upserted on submission
- `shared.contact_social_handles` — upserted on submission
- `shared.contact_addresses` — default delivery row created

## Files

| File                                | Purpose                                   |
| ----------------------------------- | ----------------------------------------- |
| `customer-onboarding.routes.js`     | Public + admin Express router             |
| `customer-onboarding.controller.js` | HTTP handlers                             |
| `customer-onboarding.service.js`    | Business logic (upserts, channel binding) |
| `customer-onboarding.repo.js`       | Parameterised SQL                         |
| `customer-onboarding.validator.js`  | Zod input schemas                         |

## Endpoints

| Method | Path                                            | Auth                     |
| ------ | ----------------------------------------------- | ------------------------ |
| POST   | `/api/v1/customer-onboarding/links`             | smartcomm.edit (staff)   |
| GET    | `/api/v1/customer-onboarding/admin/submissions` | customer_onboarding.view |
| GET    | `/api/public/onboarding/:token`                 | public (token-protected) |
| POST   | `/api/public/onboarding/:token`                 | public (token-protected) |
