-- ============================================================
-- 000241_shared_pos_recon_sender_columns
-- Add sender identity to the POS terminal reconciliation queue.
--
-- For customer-initiated bank transfers to a terminal (pay_by_transfer),
-- the useful key for staff to match a payment is WHO sent it
-- (data.customer.senderName / bankName) — the aliasAccountName is just our
-- own terminal's name and is identical on every row. The webhook handler now
-- captures these, so the queue needs columns to store them.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe whether or not the
-- base table (000240) was created with these columns.
-- ============================================================

ALTER TABLE shared.pos_terminal_reconciliation
  ADD COLUMN IF NOT EXISTS sender_name TEXT,  -- data.customer.senderName = who paid
  ADD COLUMN IF NOT EXISTS sender_bank TEXT;  -- data.customer.bankName
