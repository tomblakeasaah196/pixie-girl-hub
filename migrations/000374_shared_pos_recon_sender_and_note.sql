-- ============================================================
-- 000374_shared_pos_recon_sender_and_note
--
-- Two additive fixes to the unmatched-payment queue
-- (shared.pos_terminal_reconciliation, created in 000240):
--
--  1. sender_name / sender_bank — the webhook handler has ALWAYS passed these
--     (data.customer.senderName / bankName), but 000240 never created the
--     columns, so the repo's column allowlist silently dropped them. That is
--     why every row in Sales → POS Reconciliation renders its SENDER cell as
--     "—" even though Nomba told us who paid. Staff match a payment by who
--     sent it, so this is the single most useful field on the screen.
--
--  2. note — set at ENQUEUE time now, not just when a row is ignored, so a
--     parked row can say WHY it could not be auto-matched ("gateway self-test
--     checkout", "USD settlement — no order matched"). The column already
--     exists; nothing to add. Documented here so the intent is on record.
--
-- Purely additive: no backfill, no constraint change, safe to re-run.
-- ============================================================

ALTER TABLE shared.pos_terminal_reconciliation
  ADD COLUMN IF NOT EXISTS sender_name TEXT,
  ADD COLUMN IF NOT EXISTS sender_bank TEXT;

COMMENT ON COLUMN shared.pos_terminal_reconciliation.sender_name IS
  'Payer name as reported by the gateway (Nomba data.customer.senderName).';
COMMENT ON COLUMN shared.pos_terminal_reconciliation.sender_bank IS
  'Payer bank as reported by the gateway (Nomba data.customer.bankName).';
COMMENT ON COLUMN shared.pos_terminal_reconciliation.note IS
  'Why this payment could not be auto-matched (set at enqueue), or the reason it was ignored (set on resolve).';
