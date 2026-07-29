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
`src/modules/calls/calls.push.js` (out-of-app ring),
`apps/admin/src/components/calls/` (CallLayer: ring toasts, active-call
HUD, outcome dialog), migration `000319_shared_whatsapp_calls.sql`.

## The ring reaches three places (and none of them is optional)

A socket event only reaches a tab that is open and connected, which meant a
call could only be answered by someone already staring at the Hub. The ring
therefore travels on **three legs**, and every ringing call fires all of them:

| Leg | Reaches | Carried by |
|-----|---------|-----------|
| Socket.io | an open, connected tab | `calls.realtime.js` → `CallLayer` |
| Web Push | a closed / backgrounded app, a signed-out device | `calls.push.js` → `sw.js` |
| Reconciliation read | a tab that missed the event entirely | `GET /calls/ringing` |

### State by state

| State | What the agent gets |
|-------|--------------------|
| **In the caller's chat** | Ring banner at the top of the conversation (`InThreadCallBanner`) + ringtone + vibration. The corner toast is suppressed for that conversation so there's only ever one Answer button. Once answered the banner becomes the live-call strip, and the timeline card lands under it when the call ends. |
| **In the app, another module** | Glass ring card top-right + ringtone + vibration + flashing tab title (`📞 Ada Obi — calling`, which overrides the unread badge). |
| **In the app, tab hidden/minimised** | The above **plus** an OS notification with Answer / Decline. Deduped against the push copy by a shared `tag` (`pgh-call-<id>`), so the agent never sees two. |
| **Out of the app** (closed tab, backgrounded PWA, sleeping device) | High-urgency push → OS notification, `requireInteraction`, vibration, Answer / Decline buttons. |
| **Signed out on the device** | Same push (subscriptions survive sign-out). Tapping Answer opens the Hub, which captures the intent, takes them through login, then answers the call if it's still ringing. |
| **Answered by a colleague** | Ring drops everywhere: `call:claimed` in-app, and a `call_cancel` push closes the OS notification by tag (`requireInteraction` would otherwise leave it on the lock screen inviting an answer to a dead call). |
| **Already on a call** | No second ringtone. The new call stays in the stack and shows as an *"n more calls waiting"* chip above the call bar — so the agent knows before they hang up, instead of finding out from the missed-call task. |
| **Socket dropped mid-ring** | Push still rings. When the socket returns, reconciliation adds anything missed and drops anything already settled. A ring with no settling event self-expires client-side after 75 s (`RING_MAX_MS`), so a phantom ring and an endless ringtone are both impossible. |
| **Tab was asleep / just regained focus** | Reconciliation runs on `connect`, `visibilitychange`, `focus` and `online`. |
| **Multi-brand agent on the other brand** | Still rings. See "Entity scope" below. |
| **Ringtone blocked by autoplay policy** | The ring card shows *"Tap to enable ring sound"*. Audio is also unlocked on the first gesture of every session, so this is a fallback, not the normal path. |

### Entity scope (deliberate deviation)

Rings span **every brand the agent is authorised for**, not just the tab's
active brand. Filtering to the active brand silently dropped calls for agents
covering both — a lost sale, not an isolation win — and the notification bell
already goes cross-brand for multi-brand users (`useNotifBusiness`). Each ring
card names its brand, and answering sends the **calling** brand explicitly in
`X-Brand-Context` (`api.postForBrand`) rather than switching the app's context
under the agent mid-answer. The API re-checks brand + platform permission on
every claim regardless.

### Why the push has a TTL

Ring pushes carry `urgency: high` and `TTL: 45s`. A push that arrives after the
caller gave up is worse than no push — it wakes an agent for a call that no
longer exists — so the push service is told to drop rather than queue it. The
cancel push shares the TTL so it can never outlive the ring it closes.

### Calls bypass DND

Do Not Disturb suppresses notification toasts and chimes; a ringing customer is
not a notification. Calls ring regardless. The deliberate mute is the
notification-sound switch (`isNotifSoundEnabled`, the bell menu), which
silences the ringtone while leaving the visual ring, and the per-user
`whatsapp_call` → push preference, which turns the out-of-app ring off.

### Notification preference key

Both the ring push and the missed-call notification use the notification type
**`whatsapp_call`** (Settings → Notifications → *Incoming call*). It is
separate from `message` on purpose: an agent must be able to mute chat noise
while keeping the phone alive. No preference row means enabled, and a failed
preference lookup keeps the ring — a database hiccup must never silence a
phone.

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
5. **Out-of-app ring** — needs the VAPID keys configured
   (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL`, see
   `src/shared/push/push.service.js`) and each agent to allow
   notifications once per device. The Hub asks with its own call-specific
   prompt (`CallPushGate`). **iOS/iPadOS**: web push requires the Hub to
   be installed to the Home Screen (Share → *Add to Home Screen*) and
   opened from there — a Safari tab cannot receive push at all, and the
   gate says so rather than prompting into a dead end.

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `META_GRAPH_VERSION_CALLING` | `v23.0` | Graph version for /calls + calling settings |
| `WEBRTC_STUN_URLS` | `stun:stun.l.google.com:19302` | Comma-separated STUN list handed to the answering browser |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL` | — | Web Push credentials. **Without these there is no out-of-app ring at all** — a closed app simply cannot be reached. |

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
  call history (owner or CEO). The same is true of signing out mid-call —
  `CallLayer` tears the mic down on unmount rather than leaving the
  browser's recording indicator lit.
- **A tapped notification never navigates a focused tab.** The service
  worker holds no access token, so it cannot claim or reject anything
  itself. On a tab that is already open it `postMessage`s the intent
  (`PGH_CALL_ANSWER` / `PGH_CALL_DECLINE`) — a `client.navigate()` would
  remount the SPA and drop any live WebRTC session. Only a cold start
  opens a URL, and that intent is lifted out of the query string at boot
  (`lib/call-intent.ts`) so it survives the login bounce, which keeps
  only the pathname.
- **Push endpoints rotate.** A browser can retire a subscription behind
  the app's back; the old row then 410s on every send and the device goes
  silently deaf. The service worker's `pushsubscriptionchange` handler
  re-subscribes with the same VAPID key, and the next app load syncs the
  new endpoint to `shared.push_subscriptions`.
- **Diagnosing "the ring never arrived"**, in order: is the agent in the
  ring audience (`calls.repo.findRingAudience` — needs whatsapp
  `can_reply`, or CEO, or thread assignment)? Is `whatsapp_call` → push
  enabled for them? Are the VAPID vars set? Does
  `shared.push_subscriptions` hold a row for that device? Was the push
  older than its 45 s TTL by the time the device came online?
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
- `shared.push_subscriptions` — one row per browser/device per user; the
  out-of-app ring's only delivery target. Rows survive sign-out on
  purpose (that is what makes the signed-out state answerable) and are
  pruned when the push service reports them gone (410/404).

## API surface (all under `/api/v1/calls`, `smartcomm` permission key)

| Route | Action |
|-------|--------|
| `GET /` | Call log (filters: status, contact_id, answered_by) |
| `GET /ringing` | Rings this agent should currently be hearing — owner-first applied in SQL. The client's reconciliation read; registered above `/:id` so "ringing" isn't parsed as a call id |
| `GET /:id` | Single call |
| `POST /:id/claim` | Atomically claim a ringing call → SDP offer + ICE servers |
| `POST /:id/accept` | Relay the browser's SDP answer (goes live) |
| `POST /:id/reject` | Decline (runs missed-call follow-ups) |
| `POST /:id/hangup` | End an in-progress call |
| `POST /:id/outcome` | Record the mandatory disposition |

Plus `GET/POST /api/v1/messaging-accounts/:id/whatsapp-calling` for the
per-number enable toggle (`messaging_accounts` permission key).
