-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000247 — Outbound comms log: per-document linkage + delivery states   ║
-- ║                                                                      ║
-- ║ Two extensions so a single document (invoice/receipt/quote/delivery   ║
-- ║ note) can answer "was it sent, did it land, did she open it?" on its  ║
-- ║ own detail screen — not just on the contact timeline:                 ║
-- ║   1. reference_type/reference_id — tie a log row to the document that  ║
-- ║      triggered the send, so a per-document delivery history is cheap.  ║
-- ║   2. widen status — 'queued' (handed to the durable queue), 'delivered'║
-- ║      and 'opened' (customer viewed the public link / WhatsApp read),   ║
-- ║      'bounced' (hard provider failure), alongside the existing         ║
-- ║      sent/failed.                                                      ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

ALTER TABLE shared.outbound_comms_log
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_id   UUID;

-- Widen the status vocabulary. Drop the old 2-value CHECK and replace it.
ALTER TABLE shared.outbound_comms_log
  DROP CONSTRAINT IF EXISTS outbound_comms_log_status_check;
ALTER TABLE shared.outbound_comms_log
  ADD CONSTRAINT outbound_comms_log_status_check
  CHECK (status IN ('queued','sent','delivered','opened','failed','bounced'));

CREATE INDEX IF NOT EXISTS idx_outbound_comms_reference
  ON shared.outbound_comms_log (reference_type, reference_id, created_at DESC);

COMMIT;
