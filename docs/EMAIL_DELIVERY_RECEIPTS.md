# Email delivery receipts — real "delivered / opened / bounced"

How the Hub learns what actually happened to an email after it left, and how to
switch it on.

## The problem this solves

Until now the outbound ledger could honestly say one thing about email: *we
handed it to an SMTP relay and the relay accepted it.* That is a real fact, and
it is not the fact anyone asks about. "Did she get it?" and "did she read it?"
went unanswered, so the Delivered and Opened stages on the invoice, receipt and
delivery screens stayed dark on every email we ever sent.

Plain SMTP has no callback. The only way to know is for the sending provider to
tell us — which is what this wires up.

> **If your relay is Zoho or Google Workspace, stop here.** Neither emits
> delivery callbacks of any kind. No amount of configuration will light
> "Delivered"; the relay has to move to one of the providers below first. The
> code is ready either way — it is a config change, not an engineering one.

## What you get

| Stage | Where it comes from | Trustworthy? |
| --- | --- | --- |
| **Sent** | our own record — the relay accepted the message | always |
| **Delivered** | the provider's `delivered` event — the receiving mail server accepted it | yes, once configured |
| **Opened** | the provider's open pixel, **or** the customer loading her tracking link | indicative (see caveat) |
| **Bounced** | the provider's hard-bounce event, with the SMTP diagnostic | yes |
| **Marked spam** | the provider's complaint event | yes |

**Open-tracking caveat, worth knowing before you trust the number:** an open is
recorded when a 1×1 image loads. Apple Mail Privacy Protection pre-fetches that
image for every message whether or not the customer looks at it, and Gmail
proxies it. So opens over-count on Apple clients and under-count wherever images
are blocked. Delivered and Bounced are hard facts; treat Opened as a signal, not
proof. The Hub's own "customer loaded her tracking link" stamp is the stronger
of the two open signals, and it keeps working regardless of provider.

## Setup

Two steps, whichever provider you use: paste a secret into `.env`, then add the
URL in the provider's dashboard.

The receiver URL is always:

```
https://<your-hub-host>/api/webhooks/email/<provider>
```

Nothing is processed until the secret is set. An unconfigured provider cannot be
verified, and an unverifiable payload is logged and ignored — never acted on.

### SendGrid

1. **Settings → Mail Settings → Event Webhook.**
2. URL: `https://<host>/api/webhooks/email/sendgrid`
3. Select: *Delivered, Opened, Bounced, Dropped, Spam Reports*.
4. Turn on **Signed Event Webhook** and copy the **Verification Key**.
5. `SENDGRID_WEBHOOK_PUBLIC_KEY=<the verification key>`

SendGrid batches many events into one POST — that is expected and handled.

### Mailgun

1. **Sending → Webhooks**, for your sending domain.
2. Add a URL for each of: *Delivered Messages, Opened, Permanent Failure,
   Spam Complaints* — all pointing at
   `https://<host>/api/webhooks/email/mailgun`
3. Copy the **HTTP webhook signing key** from **Settings → API Keys**.
4. `MAILGUN_WEBHOOK_SIGNING_KEY=<the signing key>`

Temporary failures are deliberately ignored: Mailgun retries them, and recording
one as a bounce would send staff off to "fix" an address that is fine.

### Postmark

Postmark does not sign webhooks, so we use a shared token instead.

1. Invent a long random string: `openssl rand -hex 32`
2. `POSTMARK_WEBHOOK_SECRET=<that string>`
3. **Servers → your server → Webhooks → Add webhook.**
4. URL: `https://<host>/api/webhooks/email/postmark`
5. Check: *Delivery, Open, Bounce, Spam Complaint*.
6. Under **Custom headers**, add `X-Postmark-Webhook-Token` with the same string.

### Amazon SES

1. Create an SNS topic, and an SES **configuration set** publishing
   *Delivery, Open, Bounce, Complaint* to it.
2. `SES_SNS_TOPIC_ARN=arn:aws:sns:<region>:<account>:<topic>`
3. Subscribe the topic to the **HTTPS** endpoint
   `https://<host>/api/webhooks/email/ses`
4. SNS immediately posts a `SubscriptionConfirmation`. The Hub confirms it
   automatically — but only when the payload's topic ARN matches the one you
   configured *and* the confirmation URL is on `amazonaws.com`. If either check
   fails it is logged with the URL so you can visit it by hand.
5. Make sure your sends actually use the configuration set (SES ignores events
   otherwise) — set `X-SES-CONFIGURATION-SET` on the relay, or set a default
   configuration set on the sending identity.

### Resend

1. **Webhooks → Add endpoint.**
2. URL: `https://<host>/api/webhooks/email/resend`
3. Subscribe to `email.delivered`, `email.opened`, `email.bounced`,
   `email.complained`.
4. Copy the signing secret (starts `whsec_`).
5. `RESEND_WEBHOOK_SECRET=whsec_…`

## How correlation works

This is the part that is not obvious, and the part to understand before
changing any of it.

We send over **SMTP**, not a provider API. That keeps the relay swappable from
Messaging Settings, but it means a webhook arrives with no idea which of our
rows it belongs to. Two keys solve it:

1. **`message_ref`** — a short unguessable token minted per send and injected as
   a metadata header. Every provider echoes its own metadata field back on every
   event for that message:

   | Provider | Header we set | Echoed back as |
   | --- | --- | --- |
   | SendGrid | `X-SMTPAPI` (`unique_args`) | `comms_ref` on each event |
   | Mailgun | `X-Mailgun-Variables` | `user-variables.comms_ref` |
   | Postmark | `X-PM-Metadata-comms_ref` | `Metadata.comms_ref` |
   | SES | `X-SES-MESSAGE-TAGS` | `mail.tags.comms_ref` |
   | Resend | `X-Entity-Ref-ID` | echoed in `data.headers` |

2. **the SMTP `Message-ID`** — already stored as `provider_ref` on the send row.
   The fallback for a provider that echoes only that, and for mail sent before
   this feature existed.

**Every header is set on every send, deliberately.** Providers ignore metadata
they don't recognise, so the cost is a few bytes; the benefit is that repointing
the relay from Messaging Settings doesn't silently stop the receipts because
nobody remembered to change the header set.

The ref is derived from the BullMQ job id, so a retry of the same send reuses it
rather than orphaning the receipts for the attempt that actually landed.

## Reliability

The receivers reuse the existing webhook pipeline (`shared.webhook_log` →
transactional outbox → dispatcher), so they inherit everything it already does:
signature verification before processing, POST-level dedup, retry with backoff,
and the 30-minute replay sweep for anything that never completed.

On top of that:

- **Per-event idempotency.** A unique index on `(provider, provider_event_id)`
  means a redelivered event can never write a second receipt row.
- **Repeat opens collapse.** A mail client that fires the pixel on every scroll
  produces one ledger row, not forty — "when did she first see it" is the
  question the panel answers.
- **A fresh batch that matched nothing is retried.** A receipt can legitimately
  beat our own `sent` row by a fraction of a second; the outbox retries and the
  second pass finds it.
- **An old batch that matched nothing is dropped.** It belongs to mail sent
  before this shipped, or to another system sharing the relay. Retrying it 25
  times would only manufacture Kaizen noise for a receipt that can never land.

## Verifying it works

1. `npm run smtp:doctor -- --to you@example.com` — confirms the relay itself.
2. Send something real that lands on the ledger (book a delivery, send an
   invoice).
3. Open the delivery → **Customer updates**, or the invoice → **Delivery**.
   Within a minute or two of the provider processing it, a **Delivered** row
   appears tagged `via <provider>`.
4. If nothing arrives, check the provider dashboard's webhook activity log
   first — it will show the HTTP status we returned:
   - **401** — the signature failed. The secret in `.env` doesn't match the
     dashboard, or the app hasn't been restarted since you set it.
   - **200 with no ledger row** — the event correlated to nothing. Check that
     the send actually went through the Hub (only mail we sent carries the ref).
   - **nothing at all** — the URL is wrong, or the provider can't reach the host.

Server-side, `shared.webhook_log` holds every delivery with its
`signature_valid` flag and any processing error, filtered by
`source = 'email_<provider>'`.

## Files

| File | Purpose |
| --- | --- |
| `src/services/email-receipts.service.js` | Per-provider verify + parse adapters |
| `src/services/comms-log.service.js` | Correlation (`findSendForEvent`) + idempotent event write |
| `src/services/email.service.js` | Injects the correlation headers on send |
| `src/jobs/processors/email-processor.js` | Mints the ref, stamps it on the ledger row |
| `src/modules/business_setup/webhooks.routes.js` | `/api/webhooks/email/:provider` |
| `src/modules/business_setup/webhooks.service.js` | Verification + the dispatch handler |
| `migrations/000376_shared_email_delivery_receipts.sql` | Ledger columns + idempotency index |

**Adding a provider** means one entry in `PROVIDERS`, one line in `refHeaders`,
one line in `DISPATCH`, and one route. Nothing else changes.
