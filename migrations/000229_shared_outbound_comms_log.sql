-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000229 — Outbound comms log ("did this customer get her receipt?")    ║
-- ║                                                                      ║
-- ║ A lightweight per-contact audit of business→customer messages sent   ║
-- ║ OUTSIDE the chat thread — receipts, invoices, tracking, reminders —  ║
-- ║ which otherwise leave no trace on the customer's profile. Populated  ║
-- ║ at the email send chokepoint (services/email.service via the         ║
-- ║ email-send processor); WhatsApp/IG can append later. The Customer-360 ║
-- ║ panel reads the most-recent rows so staff can answer "was it sent,    ║
-- ║ and did it go out?" without digging through provider dashboards.     ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

CREATE TABLE IF NOT EXISTS shared.outbound_comms_log (
  log_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        REFERENCES shared.business_config (business_key) ON DELETE SET NULL,
  contact_id    UUID,                                  -- resolved best-effort (no FK: may be cross-brand / unmatched)
  channel       TEXT        NOT NULL DEFAULT 'email'
                            CHECK (channel IN ('email','whatsapp','instagram','sms')),
  event_key     TEXT,                                  -- e.g. invoice.sent, order.shipped, smartcomm.email_reply
  recipient     TEXT,                                  -- the to-address / number
  subject       TEXT,
  status        TEXT        NOT NULL DEFAULT 'sent'
                            CHECK (status IN ('sent','failed')),
  provider_ref  TEXT,                                  -- provider messageId, when known
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_comms_contact
  ON shared.outbound_comms_log (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_comms_business
  ON shared.outbound_comms_log (business, created_at DESC);

COMMIT;
