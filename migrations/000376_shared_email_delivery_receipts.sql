-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000376 — Real email delivery receipts from the ESP                    ║
-- ║                                                                      ║
-- ║ The outbound ledger could honestly say "we handed it to SMTP" and     ║
-- ║ nothing more. Delivered stayed dark on email because plain SMTP has   ║
-- ║ no callback, and Opened only lit when the customer clicked a link we  ║
-- ║ happened to own. This adds the columns needed to accept the           ║
-- ║ provider's OWN events (SendGrid / Mailgun / Postmark / SES / Resend). ║
-- ║                                                                      ║
-- ║ Correlation problem it solves: we send over SMTP, not a provider API, ║
-- ║ so a webhook arrives with no idea which of our rows it belongs to.    ║
-- ║ Every send now carries a `message_ref` — an unguessable token echoed  ║
-- ║ back by the provider in its own metadata field — and the SMTP         ║
-- ║ Message-ID is kept as a second key for providers that echo only that. ║
-- ║                                                                      ║
-- ║ Idempotency: provider webhooks are at-least-once, and the replay      ║
-- ║ sweep re-drives them. `provider_event_id` is uniquely indexed so a    ║
-- ║ redelivered event can never double-write a receipt row.               ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

ALTER TABLE shared.outbound_comms_log
  -- Our correlation token, injected as a provider-specific header at send
  -- time and echoed back on every event for that message.
  ADD COLUMN IF NOT EXISTS message_ref       TEXT,
  -- Which ESP reported this row ('sendgrid','mailgun','postmark','ses',
  -- 'resend'). NULL on rows we wrote ourselves at send time.
  ADD COLUMN IF NOT EXISTS provider          TEXT,
  -- The provider's own id for THIS event — the idempotency key.
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT,
  -- When the provider says it happened (not when we recorded it). A queued
  -- webhook processed minutes late must not claim the customer opened it now.
  ADD COLUMN IF NOT EXISTS event_at          TIMESTAMPTZ;

-- A spam complaint is not a bounce: the mail arrived and the customer pressed
-- "this is junk". It means stop emailing her, which is a different action from
-- fixing a bad address — so it gets its own status rather than being folded in.
ALTER TABLE shared.outbound_comms_log
  DROP CONSTRAINT IF EXISTS outbound_comms_log_status_check;
ALTER TABLE shared.outbound_comms_log
  ADD CONSTRAINT outbound_comms_log_status_check
  CHECK (status IN ('queued','sent','delivered','opened','failed','bounced','complained'));

-- Correlation lookup: webhook event → the send it belongs to.
CREATE INDEX IF NOT EXISTS idx_outbound_comms_message_ref
  ON shared.outbound_comms_log (message_ref)
  WHERE message_ref IS NOT NULL;

-- Fallback correlation for providers that echo only the SMTP Message-ID,
-- which we already store as provider_ref on the send row.
CREATE INDEX IF NOT EXISTS idx_outbound_comms_provider_ref
  ON shared.outbound_comms_log (provider_ref)
  WHERE provider_ref IS NOT NULL;

-- Idempotency: one row per provider event, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_comms_provider_event
  ON shared.outbound_comms_log (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMIT;
