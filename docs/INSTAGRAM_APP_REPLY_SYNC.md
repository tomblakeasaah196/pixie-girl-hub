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

## One command answers "is it Meta or is it us?"

The healthy path has exactly four hops — Meta delivers a
`message_echoes` webhook → `shared.webhook_log` → smartcomm ingest →
`shared.messages` (`metadata.via = 'instagram_app'`). When app replies
are missing, run this on the VPS; it checks every hop against the live
DB **and** the Meta Graph API and prints a verdict naming the broken
one:

```bash
npm run diag:instagram-echoes           # read-only diagnosis
npm run diag:instagram-echoes -- --fix  # + re-subscribe missing webhook fields
DAYS=30 npm run diag:instagram-echoes   # widen the evidence window
```

Verdicts: **META SIDE (config)** — the account isn't subscribed to
`message_echoes` (fixable immediately with `--fix`); **META SIDE
(delivery)** — subscribed but no echo ever arrives (App Dashboard /
permissions / Live-mode problem, with a checklist); **OUR SIDE** —
echoes arrive but ingest fails (prints the exact recorded error);
**HEALTHY** — echoes arrive and are recorded (missing older messages are
history from a down period → run the backfill).

## The subscription self-heals now (the watchdog)

The root cause of "it keeps breaking": the `message_echoes` subscription
lives **on the Instagram account at Meta** (`POST /me/subscribed_apps`),
not in our code or database — and any partial re-subscribe **replaces**
the whole field list, so reconnecting the account or re-running a setup
step silently drops it. Historically it was restored by hand (dashboard
toggle or curl) and drifted off again later.

That manual step is gone. `messaging-accounts.service.
ensureInstagramEchoSubscriptions()` reads each active IG account's
`subscribed_fields` and, when anything required is missing
(`messages`, `message_echoes`, `message_reactions`, `messaging_seen`),
re-subscribes with the **union** (never dropping extra fields), verifies
it stuck, audits it (`messaging_accounts.echo_subscription_healed`), and
notifies the CEO that it drifted (max one notification per brand per
day). It runs:

- **hourly** (`ig-echo-watchdog` cron, :40) — worst case the sync is
  down for one hour, and you're told it happened;
- **after the daily token sweep** (`ig-token-refresh`);
- **when an Instagram connection is saved** in Messaging → Settings;
- **inside the Test button**, whose result now includes the field list
  (`echo_sync`) so a broken subscription is visible on demand.

If the re-subscribe itself fails (revoked token, permission not granted,
app not Live), the CEO gets an **urgent** notification instead — that
situation needs Meta Dashboard attention and cannot be fixed from code.

## Failed ingests are recoverable now

Previously a messaging webhook whose ingest kept failing was lost
forever: the payment dispatcher marked the `webhook_log` row processed
immediately, so once the outbox's 10 retries were exhausted the 30-min
replay sweep (which only re-drives `processed = false` rows) could never
see it. The smartcomm consumer now owns the `processed` flag for
messaging sources — success marks it true, failure records the error on
the row — and the replay sweep re-drives stuck messaging rows through
the same idempotent ingest (provider-id dedup). A transient outage can
no longer eat an echo.

## The Meta Dashboard setting this depends on (the "works locally, fails live" gotcha)

Echo webhooks are only delivered if the Meta app is **subscribed to the
`message_echoes` webhook field** for Instagram. The account-level part
of this is now enforced automatically (see the watchdog above); the
app-level part below is one-time Meta Dashboard configuration. If
app-side replies still don't appear in the Hub:

1. [developers.facebook.com](https://developers.facebook.com) → your app →
   **Webhooks** (or **Instagram → API setup with Instagram login**) →
   product **Instagram**.
2. In the webhook subscriptions list, make sure **`messages`** *and*
   **`message_echoes`** are subscribed (add `message_reactions` /
   `messaging_seen` as already in use).
3. No server change is needed — echoes ride the same signed
   `entry.messaging[]` payload the existing endpoint already verifies.

Quick verification: reply to any customer from the Instagram app, then
check `shared.webhook_log` for a `meta_instagram` payload containing
`"is_echo":true`:

```sql
SELECT received_at, signature_valid
  FROM shared.webhook_log
 WHERE source = 'meta_instagram'
   AND payload::text LIKE '%is_echo%'
 ORDER BY received_at DESC
 LIMIT 5;
```

If none arrives within seconds, the field isn't subscribed (or the
token/app lacks `instagram_business_manage_messages`).

The dashboard toggle alone isn't always enough: with the Instagram API
with Instagram Login, the professional account itself carries a
`subscribed_apps` field list. Check and (if needed) extend it with the
brand's IG token:

```bash
# what the account is currently subscribed to:
curl "https://graph.instagram.com/v21.0/me/subscribed_apps?access_token=$IG_TOKEN"

# add message_echoes (repeat the full list — it replaces, not appends):
curl -X POST "https://graph.instagram.com/v21.0/me/subscribed_apps" \
  -d "subscribed_fields=messages,message_echoes,message_reactions,messaging_seen" \
  -d "access_token=$IG_TOKEN"
```

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

**Rate limits.** The per-conversation `/messages` read is Meta's strict
bucket. A single pass over a few hundred conversations is fine, but
running the **dry run and the real run back-to-back doubles the calls**
and trips a `403` (Meta code 4 / 17 / 32 — "request limit reached"). The
script now detects the throttle, backs off (2s → 4s → 8s), and **stops
early after 5 conversations in a row are throttled** rather than logging a
failure for every remaining thread. If you see `Stopped early (rate
limited)`: nothing is lost, **wait ~1 hour** for the window to reset, then
run the **same command again** (skip `DRY_RUN` on the resume — it's
idempotent and picks up the rest). To stay under the limit on a big first
run, do it in chunks: `CONV_LIMIT=50 npm run backfill:instagram-history`,
repeated, or raise the pacing with `GAP_MS=1000`.

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
| Diagnosis (Meta vs us) | `scripts/diagnose-instagram-echoes.js` (`npm run diag:instagram-echoes`) |
| Subscription self-heal | `src/modules/messaging_accounts/messaging-accounts.service.js` (`ensureInstagramEchoSubscriptions`), `src/jobs/schedulers/ig-echo-watchdog.js` (hourly) |
| Failed-ingest recovery | `smartcomm.subscribers.js` (owns `webhook_log.processed`), `src/jobs/processors/webhooks-replay-processor.js`, `webhooks.service.js` |
