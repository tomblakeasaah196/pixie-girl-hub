# WhatsApp Coexistence — one number on the app *and* the Cloud API

> **Decision (July 2026):** onboard the **original client-facing number**
> into Meta's Coexistence programme. Staff keep the WhatsApp Business app
> on the shop phone; the Hub becomes the system of record via message
> echoes. The newer API-only number is demoted to automation, campaigns
> and WhatsApp Calling.
>
> This doc is the implementation + operations runbook. Read
> [`INSTAGRAM_APP_REPLY_SYNC.md`](./INSTAGRAM_APP_REPLY_SYNC.md) first —
> Coexistence is the same idea (staff reply outside the Hub, Hub still
> sees it) and ~90% of that pipeline is reused verbatim.

## Why this and not a full migration

The old number is where every client relationship lives. Migrating it to
plain Cloud API means the app stops working on it, all staff move into the
Hub on day one, and **the Hub starts with an empty inbox on the number
that holds every relationship**. Coexistence instead gives us:

| Advantage | Detail |
|---|---|
| Keep the number clients already have | No re-education, no lost inbound |
| **180 days of history into the CRM** | One-shot, Coexistence-only. Seeds contacts *and* the Praxis corpus |
| Real-time two-way sync | Phone → Hub via echoes (incl. edit/revoke); Hub → phone automatic |
| App messages are **free** | Not billed, before or after the 1 Oct 2026 service-message pricing change |
| App **bypasses the 24h window** | Staff can free-form anyone, any time, no template. The API cannot |
| Cost control *without* losing data | Free human replies **and** full echo logging — not a trade-off |
| No big-bang cutover | Phone is a permanent fallback while the team migrates into the Hub |

Accepted cost: **WhatsApp Calling does not work on a Coexistence number.**
Calls ring the phone app instead, and `src/modules/calls/` +
`src/services/whatsapp-calling.service.js` go dormant *for that number*.
The code stays in the repo — it remains live on the API-only number, and
returns in full if Meta extends calling to Coexistence.

---

## ⚠️ The one ordering constraint that matters

**The history handler must be built, deployed and tested BEFORE anyone
clicks through Embedded Signup.**

Meta pushes the 180-day backfill within minutes of onboarding, you have
**24 hours** to complete the sync, and **each sync can only be performed
once**. Miss it and the only recovery is to offboard the number and redo
the entire onboarding.

Do not onboard "to see if it works." Onboarding *is* the one-shot event.

---

## Gate checks — do these before writing code

| # | Check | How | Blocks |
|---|---|---|---|
| 1 | **Country eligibility** | Run Embedded Signup up to (not through) the country step with the +234 number. Meta's changelog entry of **15 Apr 2026** added Nigeria + South Africa, so this should pass | Everything |
| 2 | **Partner status** | Coexistence is not available to a business self-integrating with its own Meta app. Either onboard via a BSP that supports it, or register the Hub as a **Tech Provider** (access verification was dropped Oct 2025, so this is now light) | Everything |
| 3 | **App version + tenure** | WhatsApp Business app **2.24.17+**, number active on it ≥7 days, on the *Business* app not consumer WhatsApp | Onboarding |
| 4 | **Meta assets** | Business Manager account + Facebook Page with admin access | Onboarding |
| 5 | **Embedded Signup version** | Target **v4**. v2 is deprecated 15 Oct 2026 | Build |

> If the number is currently on **consumer** WhatsApp, migrate it to the
> WhatsApp Business app first. Registering a Coexistence number on
> consumer WhatsApp later triggers a `PARTNER_REMOVED` disconnection with
> reason `BUSINESS_DOWNGRADE`.

---

## What Meta sends us

Three WABA webhook fields must be subscribed, **all delivered to the
phone-number-level webhook URL** we already run at
`/api/webhooks/meta/whatsapp`:

| Field | Carries | Timing |
|---|---|---|
| `smb_message_echoes` | Messages the business sends **from the app or a linked device**, plus **edits and revokes** | Real-time, ongoing |
| `history` | Up to 180 days of prior messages, in 3 phases (0–1, 1–90, 90–180 days), chunked | Minutes after onboarding, **one-shot** |
| `smb_app_state_sync` | Contacts — current set and later additions/changes | Minutes after onboarding, then ongoing |

### The payload shape trap

`INSTAGRAM_APP_REPLY_SYNC.md` documents that Instagram has **no** separate
echo field — echoes ride `messages` with `is_echo: true`. **WhatsApp is
the mirror image**, and the array name differs:

```jsonc
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "<WABA_ID>",
    "changes": [{
      "field": "smb_message_echoes",          // ← must dispatch on this
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
        "message_echoes": [{                  // ← NOT "messages"
          "from": "<BUSINESS number>",        // ← inverted vs inbound
          "to":   "<CUSTOMER number>",        // ← thread key
          "id": "wamid...",
          "timestamp": "...",
          "type": "text",
          "text": { "body": "..." }
        }]
      }
    }]
  }]
}
```

Two rules that fall out of this:

1. **Dispatch on `change.field`.** Today nothing in the codebase reads it.
2. **`to` is the thread key, `from` is us.** The opposite of `messages[]`.
   (Same principle as the IG parser, which keys on the recipient.)

Edit and revoke echoes carry **`original_message_id`** pointing at the
message being changed. Meta added these on 25 Nov 2025 — third-party BSP
docs claiming edit/revoke is "no longer supported" are pre-Nov-2025 text.

---

## Engineering work

Ordered by dependency. Estimate: **2–3 focused days**, because the
Instagram work already did the hard parts.

### Already works — no change needed

| Asset | Location |
|---|---|
| Webhook endpoint, **HMAC verification**, `webhook_log`, outbox, 30-min replay sweep | `business_setup/webhooks.{routes,service}.js`. `extractMetaExternalId()` already reads `change.value.metadata.phone_number_id`, which Coexistence payloads carry — signatures verify unchanged |
| **Full echo semantics** — dedup on `external_ref` *and* `sequence_mids`, deferred ingest while a Hub send is still `queued`, transactional re-check | `smartcomm.service.js:2057` `recordAgentReplyFromPlatform()` |
| `external_read_at` unread watermark, bell consumption, monotonic backfill safety | migration `000348`, same function |
| Business-side bubble rendering + "via … app" caption | `MessageBubble.tsx:106`, `MessageThread.tsx:1284` |
| Per-brand encrypted credentials | `messaging_accounts` — already multi-number |
| Inbound media download → document | `whatsapp.service.js` `downloadMedia()` |
| **24h window trigger** | `shared.fn_smartcomm_refresh_wa_window()` (`000213`/`000290`) fires only when `sender_contact_id IS NOT NULL`. Echo rows are business-side with no `sender_contact_id`, so **an app reply cannot falsely reset the window** — already correct |

### To build

**1. Field dispatch (blocking, do first)**
`smartcomm.subscribers.js` — `parseMetaWhatsApp()` iterates `entry.changes`
and reads only `value.messages`. An `smb_message_echoes` payload parses to
zero events and is marked processed, i.e. **silently lost**. Add
`parseMetaWhatsAppEchoes()` reading `value.message_echoes`, keyed on `to`,
and dispatch on `change.field` in `onWebhookReceived()`.

**2. Parameterise the echo recorder**
`recordAgentReplyFromPlatform()` hardcodes `messageMetadata.via =
"instagram_app"` and defaults `platform` to `"instagram"`. Everything else
is already platform-generic. Add `whatsapp_app`.

**3. Frontend `via` handling**
`MessageBubble.tsx` and `MessageThread.tsx` compare against the literal
`"instagram_app"`; `smartcomm-types.ts` documents it. Accept
`whatsapp_app` and caption it "via WhatsApp app".

**4. `history` handler — net-new, no Instagram analogue**
The IG backfill was a REST *pull* (`backfill:instagram-history`); WhatsApp
history is a **webhook push**. Must:
- reassemble chunks via `chunk_order`, tracking `progress` to 100
- process **asynchronously** — one payload can describe thousands of messages
- be idempotent on message id, and reuse `occurred_at` + `quiet` so
  backfilled rows never un-read newer messages or fire bells
- tolerate media asset ids only being present for media sent within 14
  days of onboarding
- **group chats are excluded** — expect gaps

**5. `smb_app_state_sync` handler**
Map contacts into `shared.contacts` / social handles. Reuse
`resolveOrCreateContact()`; respect `isPlaceholderName()` healing.

**6. Edit / revoke**
New concept — `shared.messages` has no edited/revoked state. Needs a
migration and a UI decision (strikethrough vs "message deleted" tombstone).
Resolve by `original_message_id`.

**7. WhatsApp webhook-field self-healing**
`ensureEchoSubscriptionForToken()` targets
`graph.instagram.com/me/subscribed_apps`. WhatsApp subscriptions live on
the **WABA node** (`/{waba_id}/subscribed_apps`). Build the sibling
covering all three fields, plus a `wa-echo-watchdog` mirroring
`ig-echo-watchdog`.
⚠️ The existing code comment applies here too: **`subscribed_apps`
REPLACES the list** — always POST the union, and one invalid field can
reject the whole update.

**8. Diagnostics**
Mirror `npm run diag:instagram-echoes` as `diag:whatsapp-echoes` —
Meta → `webhook_log` → ingest → `shared.messages`. This is what answers
"is it Meta or is it us?" at 11pm.

---

## Onboarding day — runbook

Do not start until §"Engineering work" items **1, 2, 4, 5** are deployed
to production and verified against a replayed payload.

1. **Freeze.** No deploys during the window.
2. **Confirm the primary phone is charged, online and stays that way.**
3. **Back up** `shared.messages` and `shared.contacts`.
4. **Tail the webhook log** — watch `shared.webhook_log` live.
5. Run **Embedded Signup v4** for the old number. Scan the QR **in the
   WhatsApp Business app**.
6. **Say YES to the history sync prompt.** This is the one-shot. Skipping
   it means offboard + redo.
7. Confirm subscription to all three fields on the WABA node.
8. **Watch history land** — phases 0–1, 1–90, 90–180. Track `progress` to
   100. Must complete **within 24 hours**.
9. **Re-link companion devices.** All linked devices are unlinked at
   onboarding. WhatsApp for Windows and WearOS are unsupported and will
   not produce echoes.
10. Send a test message **from the phone** → confirm it appears in the Hub
    thread tagged "via WhatsApp app".
11. Send a test **from the Hub** → confirm it appears on the phone **and**
    that the returning echo dedups (no double bubble).

### Expect on day one

- **A dead zone.** A window only opens if the customer messages *after*
  onboarding. Clients who messaged just before it can only be answered
  with a template.
- **`unsupported` message webhooks with error 131060** on first inbound
  messages. Expected; resolves in seconds.

---

## Operating rules once live

- **Someone must open the primary phone at least every 14 days** or the
  connection drops (`PRIMARY_INACTIVITY`). Companion devices: ~30 days.
  Put this on a recurring task.
- **Templates can only be sent from the Hub**, never the app.
- **Free-form outside the 24h window can only be sent from the app.** The
  app is the legitimate window-opener: staff messages a cold client from
  the phone → client replies → window opens → Hub automation takes over.
- App sends are **free** and do **not** create, extend or affect Cloud API
  windows or pricing.
- Throughput on this number is capped at **20 messages/second**.

## The API-only number keeps

Campaigns, template broadcasts, order and delivery notifications, and
**WhatsApp Calling** (`src/modules/calls/`) — fully functional there, on
plain Cloud API, with no Coexistence restrictions. Both numbers feed the
same Hub inbox via `messaging_accounts`; the dual-number pain disappears
because the ERP is the single pane of glass.

## Limitations accepted on the Coexistence number

Broadcast lists disabled (existing become read-only) · disappearing
messages, view-once and live location off for 1:1 chats · group chats do
not sync · voice/video calls app-only, not on the API · no Official
Business Account (blue badge) · no standard business verification ·
`setProfilePicture()` dormant (profile picture updates unsupported after
onboarding) · WABA migration unsupported · one BSP/Tech Partner per number.

## Rollback

Offboarding is supported and returns the number to app-only. It does
**not** restore Cloud API-only mode with history intact — treat rollback
as "back to where we started", not as a free undo. Keep the API-only
number live throughout so there is always a working API path.

## Verify before building

1. Whether `history` and `smb_app_state_sync` payloads carry
   `value.metadata.phone_number_id`. HMAC verification resolves the app
   secret from it (`extractMetaExternalId()`); if they don't, that
   function needs a fallback or those payloads will fail signature checks
   **and be dropped** — during the one-shot window.
2. Exact `history` chunk envelope (field names, `chunk_order`, `progress`)
   against Meta's live reference.
3. Whether the one-number-per-Coexistence-account limit is real (currently
   third-party only) — matters if Faitlynhair later wants its own
   Coexistence number.

## Sources

Meta (primary): *Onboard WhatsApp Business app users* (Embedded Signup) ·
`smb_message_echoes` webhook reference · WhatsApp pricing + *Upcoming
pricing updates for non-template messages* · Cloud API changelog
(15 Apr 2026 — Nigeria/South Africa supported; 25 Nov 2025 — edit/revoke
webhooks; 3 Oct 2025 — Tech Provider access verification dropped).

Third-party (treat as lagging): 360dialog Coexistence + Coexistence
Webhooks · Chatwoot #13466 (reference `smb_message_echoes` implementation)
· ChakraHQ · Wati · respond.io · Whautomate.

In-repo: `INSTAGRAM_APP_REPLY_SYNC.md`, `WHATSAPP_CALLING.md`,
`smartcomm.{subscribers,service,repo}.js`,
`business_setup/webhooks.service.js`,
`messaging_accounts/messaging-accounts.service.js`,
`migrations/000213_shared_smartcomm_v2.sql`,
`migrations/000290_shared_smartcomm_ig_window.sql`.
