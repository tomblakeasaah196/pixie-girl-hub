# Messaging Accounts

CEO-editable directory of which brand owns which WhatsApp number /
Instagram Business Account / Facebook Page / inbound mailbox. The
smartcomm webhook handler looks up by `(platform, external_account_id)`
on every inbound to route messages to the right brand's inbox.

**Spec:** Pixie Girl Hub V2.2 §6.17 (Smartcomm — webhook routing).
**Permission key:** `messaging_accounts`

## Why it exists

Without these rows, the smartcomm webhook ingester drops every
inbound message with a "no messaging_accounts row" warning. This module
is what lets the CEO add a WhatsApp phone-number-id, paste the Meta
access token, and start receiving DMs in the unified inbox.

## Backing table

- `shared.messaging_accounts` (shipped in migration 000213)

## Files

| File                                       | Purpose                              |
| ------------------------------------------ | ------------------------------------ |
| `messaging-accounts.routes.js`             | Express router                       |
| `messaging-accounts.controller.js`         | HTTP handlers                        |
| `messaging-accounts.service.js`            | Business logic + audit + provider ping |
| `messaging-accounts.repo.js`               | Parameterised SQL                    |
| `messaging-accounts.validator.js`          | Zod input schemas                    |

## Endpoints

| Method | Path                                        |
| ------ | ------------------------------------------- |
| GET    | `/api/v1/messaging-accounts`                |
| POST   | `/api/v1/messaging-accounts`                |
| GET    | `/api/v1/messaging-accounts/:id`            |
| POST   | `/api/v1/messaging-accounts/:id/active`     |
| POST   | `/api/v1/messaging-accounts/:id/test`       |
| DELETE | `/api/v1/messaging-accounts/:id`            |

## Tokens at rest

`access_token_enc` is AES-256-GCM encrypted via `encryption.service`.
The list + read endpoints return only a `has_access_token` boolean —
the ciphertext never leaves the backend.

## Test ping

`/:id/test` calls the provider with the saved token to verify config:
- WhatsApp/Instagram/Facebook → Meta Graph `GET /{external_account_id}?fields=id,name`
- Email → DNS MX record lookup on the inbound domain
