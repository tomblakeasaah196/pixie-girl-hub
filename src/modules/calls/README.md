# WhatsApp Calls (Cloud API Calling)

Inbound voice calls from customers, answered by staff in the Hub browser
over WebRTC. Implements options **1a / 2a / 3a / 4a / 5a** of the calling
spec conversation:

- **1a** — calls are answered inside the admin app (SmartComm surface),
  browser + headset, no external phone system.
- **2a** — both brands from day one (per-brand numbers via
  `shared.messaging_accounts`, same as message sends).
- **3a** — the conversation owner (`message_channels.assigned_to`) rings
  first; after 15 s with no claim the ring widens to every online agent.
  Unassigned threads ring everyone immediately.
- **4a** — missed calls trigger an automatic WhatsApp reply, a high-priority
  CRM task assigned to the conversation owner, and a notification.
- **5a** — every call lands as a `call` card on the customer's SmartComm
  thread; completed calls require the answering agent to record an outcome
  (deal closed, order placed, follow up, …) with optional notes.

## Flow

```
customer taps call → Meta webhook (calls/connect + SDP offer)
  → webhooks.service (verify + log + outbox)
      ├─ inline fast path (same process, ~0 ms)   ┐ both call
      └─ outbox consumer  (worker, ≤5 s, durable) ┘ ingestCallsPayload (idempotent)
  → whatsapp_calls row (ringing) + ring socket events
  → agent claims (atomic) → browser builds SDP answer → POST accept → Meta /calls edge
  → audio flows browser ⇄ Meta directly (WebRTC; the backend never touches media)
  → terminate (webhook or hangup) → timeline card (+ missed follow-ups) → outcome
```

## Files

Standard module shape: `calls.routes.js` (mounted at `/api/v1/calls`,
`smartcomm` permission key), `calls.controller.js`, `calls.service.js`
(state machine), `calls.repo.js` (`shared.whatsapp_calls` +
`shared.whatsapp_call_events`, migration 000318), `calls.validator.js`,
`calls.events.js` + `calls.realtime.js` (Socket.io rooms
`brand:{key}:calls` / `user:{id}:calls`), `calls.subscribers.js`
(durable `webhook.received` consumer). Graph signalling lives in
`src/services/whatsapp-calling.service.js`; ring timers ride the
`calls-lifecycle` BullMQ queue (`src/jobs/processors/calls-processor.js`).

See `docs/WHATSAPP_CALLING.md` for Meta setup (enable calling on the
number, webhook subscription, Graph version) and operational notes.
