# WhatsApp Business Calling (inbound voice)

Customers tap the **call button** in the brand's WhatsApp chat; the call
rings sales agents **inside the Hub** (browser + headset, WebRTC) — no
phone system, no extra hardware. Built on Meta's **Cloud API Calling**
(the same Cloud API the platform already uses for messages), per brand,
via `shared.messaging_accounts`.

> **Direction note (Nigeria):** *user-initiated* (customer → business)
> calling is available everywhere the Cloud API is, including Nigeria,
> and answered-via-API calls are free. *Business-initiated* (outbound)
> calling is currently **not available for Nigerian business numbers** —
> a Meta restriction, not a platform one. The sales flow is therefore
> "message first, client taps call": prompt the client in chat, they
> call you. The schema and state machine already carry a `direction`
> column so outbound can be added if/when Meta lifts the restriction.

## What was agreed (spec options)

| # | Decision |
|---|----------|
| 1a | Calls are answered **in the browser** (SmartComm surface), WebRTC + headset |
| 2a | **Both brands** from day one (per-number config, same as message sends) |
| 3a | **Conversation owner rings first**; after **15 s** unclaimed, every online agent rings; unassigned threads ring everyone immediately |
| 4a | **Missed call** → auto WhatsApp reply + **high-priority CRM task** assigned to the conversation owner + notification |
| 5a | **Full logging**: every call is a `call` card on the customer's thread; completed calls **require an outcome** (deal closed, order placed, follow up, …) with optional notes |

## Architecture

```
customer taps call
  → Meta webhook  POST /api/webhooks/meta/whatsapp   field: "calls"
      event: connect  (carries the SDP offer)
  → webhooks.service: verify HMAC → shared.webhook_log → outbox
      ├─ inline fast path  (API process, immediate — ring latency)
      └─ outbox consumer   (worker, ≤5 s — crash-safe re-run)
      both → calls.service.ingestCallsPayload (idempotent)
  → shared.whatsapp_calls row (status=ringing) + Socket.io ring
      owner ring:  user:{owner}:calls        (thread assigned)
      brand ring:  brand:{brand}:calls        (unassigned, or +15 s escalation
                                               via the calls-lifecycle queue)
  → agent clicks Answer
      POST /calls/:id/claim    ← atomic; exactly one winner; returns SDP offer + STUN
      browser: getUserMedia → RTCPeerConnection → SDP answer
      POST /calls/:id/accept   ← relays the answer to Meta's /calls edge
  → audio flows browser ⇄ Meta directly (SRTP); the backend never touches media
  → hangup (either side) / terminate webhook
      → status completed|missed|failed → 'call' card on the SmartComm thread
      → missed: auto-reply + CRM task + notification
      → completed: agent records the outcome (mandatory dialog)
```

Key modules: `src/modules/calls/` (state machine + HTTP),
`src/services/whatsapp-calling.service.js` (Graph signalling + calling
settings), `src/jobs/processors/calls-processor.js` (escalate /
stale-sweep on the `calls-lifecycle` queue),
`apps/admin/src/components/calls/` (CallLayer: ring toasts, active-call
HUD, outcome dialog), migration `000318_shared_whatsapp_calls.sql`.

## Meta setup (per brand / phone number)

1. **Prerequisites** — the number is on the Cloud API with a messaging
   limit of **2,000+ conversations/day**, and the WABA token has
   `whatsapp_business_messaging`. Calling endpoints ride Graph
   **v23.0+** (`META_GRAPH_VERSION_CALLING`, separate from the message
   pin so upgrading calling never touches sends).
2. **Webhook** — the app must be subscribed to the **`calls`** webhook
   field (next to `messages`) in the Meta App Dashboard → WhatsApp →
   Configuration. Payloads arrive on the existing
   `/api/webhooks/meta/whatsapp` endpoint; no new URL.
3. **Enable calling on the number** — in the Hub: *Messaging → settings
   gear → WhatsApp → Voice calling* toggle (writes Meta's
   `calling.status` + `call_icon_visibility=DEFAULT` via
   `POST /messaging-accounts/:id/whatsapp-calling`). Repeat per brand.
4. **Agents** — need `smartcomm` module access to see/ring, and
   per-platform **reply** permission on WhatsApp
   (`shared.smartcomm_platform_permissions`) to answer, decline or
   hang up. First browser answer prompts for microphone access (HTTPS
   origin required).

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `META_GRAPH_VERSION_CALLING` | `v23.0` | Graph version for /calls + calling settings |
| `WEBRTC_STUN_URLS` | `stun:stun.l.google.com:19302` | Comma-separated STUN list handed to the answering browser |

## Operational notes

- **Ring latency** — the transactional outbox polls every ~5 s in the
  worker; fine for messages, an eternity for a phone. The webhook
  receiver therefore fires the ingest **inline** post-commit (not
  awaited), and the outbox consumer re-runs the same idempotent ingest
  for durability. Dedup anchors: unique `wa_call_id` on the call row,
  unique `(call_id, event)` on the event trail.
- **Worker required** — escalation (+15 s) and the stale-ring sweep ride
  BullMQ (`calls-lifecycle`), so `npm run workers:start` (or
  `ENABLE_WORKERS=true`) must be live for owner-first escalation. If
  Redis is briefly down, the ring itself still works (it's emitted from
  the ingest path); only escalation/sweep degrade.
- **Lost terminate webhooks** — a ringing row with no terminate after
  ~2 min is settled as `missed` by the sweep (`stale_no_terminate`) so
  the missed-call follow-ups still run.
- **Entity scope** — ring toasts honour the active brand (non-negotiable
  #1): a tab on Pixie Girl only rings Pixie Girl's calls. Agents
  covering both brands keep a tab per brand (or switch), same as the
  rest of the Hub.
- **Auto-reply copy** — v1 ships a fixed, warm default in
  `calls.service.js` (`MISSED_CALL_REPLY`); a natural follow-up is
  moving it into Comms Studio next to the layaway/birthday automations.
- **Page reload during a live call** drops the browser leg; the customer
  side ends, Meta sends `terminate`, and the call settles as completed
  with the recorded duration. The outcome can still be filed from the
  call history (owner or CEO).
- **Free** — user-initiated calls answered via the API carry no Meta
  usage charge (unlike template messages).

## Data

- `shared.whatsapp_calls` — one row per call; state machine
  `ringing → in_progress → completed | missed | rejected | failed`;
  agent, timings, duration, outcome + notes, missed-call follow-up
  flags (`auto_reply_sent`, `missed_task_id`).
- `shared.whatsapp_call_events` — append-only audit: Meta events
  (connect/terminate) + our actions (claimed, accepted, rejected,
  hangup), raw payloads included.
- SmartComm timeline — `shared.messages` rows with
  `message_type='call'` (whitelisted metadata: status, duration,
  answered-by, outcome), so the conversation reads chronologically:
  messages *and* calls.
- CRM — missed calls create `shared.tasks` rows
  (`reference_type='whatsapp_call'`, priority high, status today).

## API surface (all under `/api/v1/calls`, `smartcomm` permission key)

| Route | Action |
|-------|--------|
| `GET /` | Call log (filters: status, contact_id, answered_by) |
| `GET /:id` | Single call |
| `POST /:id/claim` | Atomically claim a ringing call → SDP offer + ICE servers |
| `POST /:id/accept` | Relay the browser's SDP answer (goes live) |
| `POST /:id/reject` | Decline (runs missed-call follow-ups) |
| `POST /:id/hangup` | End an in-progress call |
| `POST /:id/outcome` | Record the mandatory disposition |

Plus `GET/POST /api/v1/messaging-accounts/:id/whatsapp-calling` for the
per-number enable toggle (`messaging_accounts` permission key).
