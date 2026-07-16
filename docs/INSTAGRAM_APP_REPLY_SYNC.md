# Instagram in-app replies → Hub sync (message echoes)

> The "three people answered the same customer" fix. Staff replies sent
> from the **Instagram app** now land in the Hub's Messaging thread and
> clear its unread badge. This doc covers how it works, the one Meta
> Dashboard setting it depends on, and how to backfill history that was
> lost before it shipped.

## The problem it solves

The Hub ingests Instagram DMs via Meta webhooks. Customer messages arrive
as normal `messages` events — but when **our own side** sends a message,
Meta reports it as a **message echo** (`message.is_echo = true`). That's
true for messages the Hub sends via the API *and* for replies a staffer
types directly in the Instagram app.

The old ingest skipped every echo ("we record those at send time" — true
only for Hub-originated sends). Consequences:

- Replies sent from the Instagram app were **invisible in the Hub**.
- Threads looked unanswered, so several people would answer the same
  customer — from the app, from the Hub, or both.
- Unread badges never cleared for conversations handled in the app.

## How it works now

1. **Echo ingest** (`smartcomm.subscribers.parseMetaInstagram` →
   `smartcomm.service.recordAgentReplyFromPlatform`): echo events are
   parsed with the **recipient** (the customer) as the thread key and
   recorded as business-side bubbles tagged `via: instagram_app`
   (rendered right-aligned with a *"via Instagram app"* caption; they
   read as **staff** in Praxis transcripts).
2. **Dedup against Hub sends**: echoes also fire for messages the Hub
   itself sent. Those are recognised by provider message id —
   `shared.messages.external_ref`, plus `metadata.sequence_mids` for
   multi-bubble catalogue shares (every bubble's mid is stamped at send
   time). If a Hub send is still `queued` (mid not yet stamped), the echo
   ingest defers via the outbox's retry/backoff and dedups on the next
   attempt.
3. **Unread semantics** (deliberate, and the only ones Meta's events
   allow):
   - **Replied from the app** → the thread's unread badge clears for the
     whole team, and its bell notifications are consumed. Implemented via
     `shared.message_channels.external_read_at` (migration 000348) — a
     channel-wide, monotonic "handled externally up to" watermark folded
     into every unread count (`GREATEST(cm.last_read_at,
     c.external_read_at)`).
   - **Opened in the app but NOT answered** → stays unread in the Hub.
     Meta sends **no webhook** for a staffer merely reading a DM in the
     app, so there is nothing to react to — which matches the desired
     behaviour: an unanswered conversation must keep demanding attention.
   - A customer message arriving **after** the app-side reply counts as
     unread again, as normal.

## The Meta Dashboard setting this depends on (the "works locally, fails live" gotcha)

Echo webhooks are only delivered if the Meta app is **subscribed to the
`message_echoes` webhook field** for Instagram. If app-side replies still
don't appear in the Hub:

1. [developers.facebook.com](https://developers.facebook.com) → your app →
   **Webhooks** (or **Instagram → API setup with Instagram login**) →
   product **Instagram**.
2. In the webhook subscriptions list, make sure **`messages`** *and*
   **`message_echoes`** are subscribed (add `message_reactions` /
   `messaging_seen` as already in use).
3. No server change is needed — echoes ride the same signed
   `entry.messaging[]` payload the existing endpoint already verifies.

Quick verification: reply to any customer from the Instagram app, then
check `shared.webhook_logs` for a `meta_instagram` payload containing
`"is_echo":true`. If none arrives within seconds, the field isn't
subscribed (or the token/app lacks `instagram_business_manage_messages`).

## Backfilling history that was lost before this shipped

```bash
# report what would be recovered, write nothing:
DRY_RUN=1 npm run backfill:instagram-history

# recover both brands, conversations updated in the last 30 days:
npm run backfill:instagram-history

# one brand, further back, more conversations:
BRAND=faitlynhair DAYS=90 CONV_LIMIT=500 npm run backfill:instagram-history
```

What it does: walks the Graph **conversations API** with each brand's
stored IG token and pushes every message through the same ingest pipeline
as live webhooks — customer messages as inbound, our messages as
"via Instagram app" replies (which also settles each thread's unread
state to match reality). Messages keep their **original timestamps**, no
realtime pings or bell notifications are fired, and it's **idempotent**
(provider-id dedup + a fuzzy content/time guard), so re-running is safe.
It never sends anything to customers.

**Hard Meta limitation:** the conversations API returns full content only
for the **~20 most recent messages per conversation**; older rows come
back truncated and are skipped. The backfill recovers the recent trend of
every thread — not the deep archive. (That deep history still exists in
the Instagram app itself.)

## Files involved

| Piece | Where |
| --- | --- |
| Echo parsing + ingest routing | `src/modules/smartcomm/smartcomm.subscribers.js` |
| Recorder + unread watermark | `src/modules/smartcomm/smartcomm.service.js` (`recordAgentReplyFromPlatform`), `smartcomm.repo.js` |
| Migration | `migrations/000348_shared_smartcomm_external_read.sql` |
| Sequence-mid stamping | `src/jobs/processors/instagram-processor.js` |
| Team-wide bell clearing | `src/services/notifications.service.js` (`markReadByReferenceAllUsers`) |
| Bubble rendering ("via Instagram app") | `apps/admin/src/components/messaging/MessageBubble.tsx`, `MessageThread.tsx` |
| Backfill | `scripts/backfill-instagram-history.js` (`npm run backfill:instagram-history`) |
