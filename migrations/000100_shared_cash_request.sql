-- ============================================================
-- MIGRATION 000016 — shared Cash Request & Disbursement (V2.2 §6.32)
-- Pixie Girl Hub · JBS Praxis · Conformance pass
--
-- B-1: NEW MODULE — Module 6.32 (entire new spec module).
--
-- The 4-stage workflow (V2.2 §6.32):
--   STAGE 1: User submits        → status='pending_finance'
--   STAGE 2: Finance validates   → status='pending_ceo' (above threshold)
--                                  OR status='approved' (below threshold)
--   STAGE 3: CEO approves        → status='approved' (above threshold)
--   STAGE 4: Finance disburses   → status='disbursed' (mandatory bank_transaction_id)
--   POST: settlement             → status='settled' (for cash advances)
--
-- Status pills (V2.2 §6.32):
--   Draft | Pending Finance | Pending CEO | Approved | Disbursed |
--   Rejected | Sent Back | Settled
--
-- Match status pill (separate):
--   Unmatched | Matched | Mismatch | Manual Review
--
-- Shared table with `business` discriminator (RLS to be added in Phase 6
-- per architecture decision C-1).
--
-- Tables:
--   cash_requests              — header
--   cash_request_state_history — append-only state transitions
--   cash_request_documents     — receipts, quotes, attachments
--   cash_request_settlements   — for cash advances: receipts of spend
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ cash_requests                                                      ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.cash_requests (
  cash_request_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE RESTRICT,
  request_number        TEXT        NOT NULL UNIQUE,            -- 'PXG-CR-0001'
  -- ── Submission
  submitted_by          UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE RESTRICT,
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Category drives default GL account + workflow routing (V2.2 §6.7
  -- companion). Same category set as expense_categories.
  category_key          TEXT        NOT NULL,
  category_display      TEXT        NOT NULL,
  -- Purpose & narrative
  purpose               TEXT        NOT NULL,
  needed_by_date        DATE,
  urgency               TEXT        NOT NULL DEFAULT 'normal'
                        CHECK (urgency IN ('normal','urgent','critical')),
  -- ── Financial
  amount_requested_ngn  NUMERIC(14,2) NOT NULL CHECK (amount_requested_ngn > 0),
  currency_code         TEXT        NOT NULL DEFAULT 'NGN'
                        REFERENCES shared.currencies (currency_code),
  -- If non-NGN, snapshot the FX rate used
  fx_rate_used          NUMERIC(15,6),
  display_amount        NUMERIC(14,2),                          -- amount in original currency
  -- ── Recipient / destination of the funds
  recipient_type        TEXT        NOT NULL
                        CHECK (recipient_type IN ('self_bank','self_cash','third_party_bank','petty_cash','supplier_direct')),
  recipient_name        TEXT,
  recipient_bank_name   TEXT,
  recipient_account_number TEXT,
  recipient_account_name TEXT,
  -- ── Lifecycle — V2.2 §6.32 status pills
  status                TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN (
                          'draft',            -- still being filled in
                          'pending_finance',  -- submitted, Finance review next
                          'pending_ceo',      -- Finance approved, CEO review next
                          'approved',         -- both approvals done (or below CEO threshold)
                          'rejected',         -- declined at any stage
                          'sent_back',        -- needs clarification from submitter
                          'disbursed',        -- money sent
                          'settled',          -- receipts in (for advances)
                          'cancelled'         -- by submitter before disbursement
                        )),
  -- ── Stage 2: Finance review
  finance_reviewed_by   UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  finance_reviewed_at   TIMESTAMPTZ,
  finance_decision      TEXT        CHECK (finance_decision IN ('approve','reject','send_back',NULL)),
  finance_notes         TEXT,
  -- Did this need CEO approval? Computed from amount vs business_config
  -- cash_request_ceo_threshold_ngn at the time of Finance approval.
  requires_ceo_approval BOOLEAN,
  ceo_threshold_at_submit_ngn NUMERIC(14,2),                    -- snapshot
  -- ── Stage 3: CEO approval (when requires_ceo_approval = true)
  ceo_decided_by        UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  ceo_decided_at        TIMESTAMPTZ,
  ceo_decision          TEXT        CHECK (ceo_decision IN ('approve','reject','send_back',NULL)),
  ceo_notes             TEXT,
  -- ── Stage 4: Disbursement
  disbursed_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  disbursed_at          TIMESTAMPTZ,
  -- MANDATORY at disbursement (V2.2 §6.32 explicit requirement).
  -- Trigger enforces this when status transitions to 'disbursed'.
  bank_transaction_id   TEXT,
  bank_transaction_date DATE,
  bank_name             TEXT,
  -- Actual disbursed amount (may differ from requested if FX moved
  -- or if Finance adjusts the figure before transfer)
  amount_disbursed_ngn  NUMERIC(14,2),
  disbursement_notes    TEXT,
  -- ── Bank reconciliation match status (separate pill)
  -- Set by reconciliation engine when bank statement is imported and
  -- this transaction is matched to a statement line.
  match_status          TEXT        NOT NULL DEFAULT 'unmatched'
                        CHECK (match_status IN ('unmatched','matched','mismatch','manual_review','not_applicable')),
  matched_bank_statement_line_id UUID,                           -- soft FK to {brand}.bank_statement_lines
  matched_at            TIMESTAMPTZ,
  match_variance_ngn    NUMERIC(14,2),
  -- ── Settlement (only for cash advances, not direct expenses)
  -- Spec: "unsettled cash advance → payroll deduction"
  requires_settlement   BOOLEAN     NOT NULL DEFAULT false,
  settled_at            TIMESTAMPTZ,
  settlement_required_by DATE,                                  -- typically disbursed + 14 days
  settled_total_receipts_ngn NUMERIC(14,2),
  unsettled_balance_ngn NUMERIC(14,2),                          -- for payroll auto-deduct
  payroll_deduction_run_id UUID,                                -- soft FK to {brand}.payroll_runs
  -- ── Cross-module linkages (soft FKs per business)
  -- When category links to an existing supplier/vendor/expense flow.
  linked_expense_id     UUID,                                   -- soft FK to {brand}.expenses
  linked_supplier_invoice_id UUID,                              -- soft FK to {brand}.supplier_invoices
  linked_journal_entry_id UUID,                                 -- soft FK to {brand}.journal_entries (auto-posted on disbursement)
  -- ── Cancellation
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  cancellation_reason   TEXT,
  -- ── Workflow instance (if routed via workflow engine)
  workflow_instance_id  UUID        REFERENCES shared.workflow_instances (instance_id) ON DELETE SET NULL,
  -- ── Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ── Invariants
  CONSTRAINT cash_request_disbursement_complete
    CHECK (
      status <> 'disbursed' OR (
        disbursed_by IS NOT NULL
        AND disbursed_at IS NOT NULL
        AND bank_transaction_id IS NOT NULL
        AND amount_disbursed_ngn IS NOT NULL
      )
    ),
  CONSTRAINT cash_request_settled_complete
    CHECK (
      status <> 'settled' OR (
        settled_at IS NOT NULL
        AND requires_settlement = true
      )
    )
);
CREATE TRIGGER trg_cash_requests_updated_at
  BEFORE UPDATE ON shared.cash_requests
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_cash_requests_business_status
  ON shared.cash_requests (business, status, submitted_at DESC);
CREATE INDEX idx_cash_requests_pending_finance
  ON shared.cash_requests (business, submitted_at)
  WHERE status = 'pending_finance';
CREATE INDEX idx_cash_requests_pending_ceo
  ON shared.cash_requests (business, finance_reviewed_at)
  WHERE status = 'pending_ceo';
CREATE INDEX idx_cash_requests_unsettled
  ON shared.cash_requests (business, settlement_required_by)
  WHERE requires_settlement = true AND status = 'disbursed' AND settled_at IS NULL;
CREATE INDEX idx_cash_requests_unmatched
  ON shared.cash_requests (business, disbursed_at DESC)
  WHERE status IN ('disbursed','settled') AND match_status = 'unmatched';
CREATE INDEX idx_cash_requests_submitted_by
  ON shared.cash_requests (submitted_by, submitted_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ cash_request_state_history                                         ║
-- ║ Append-only audit trail of every state transition.                 ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.cash_request_state_history (
  history_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_request_id       UUID        NOT NULL REFERENCES shared.cash_requests (cash_request_id) ON DELETE CASCADE,
  from_status           TEXT,
  to_status             TEXT        NOT NULL,
  changed_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                 TEXT,
  -- For auditability — what amounts / decisions were in effect at this transition
  amount_snapshot_ngn   NUMERIC(14,2),
  decision_snapshot     TEXT,
  metadata              JSONB
);
CREATE INDEX idx_cash_request_history_request
  ON shared.cash_request_state_history (cash_request_id, changed_at);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ cash_request_documents                                             ║
-- ║ Supporting attachments: quotes, invoices, receipts.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.cash_request_documents (
  document_link_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_request_id       UUID        NOT NULL REFERENCES shared.cash_requests (cash_request_id) ON DELETE CASCADE,
  -- Link to the documents library
  document_id           UUID        NOT NULL REFERENCES shared.documents (document_id) ON DELETE CASCADE,
  -- What role this doc plays
  document_role         TEXT        NOT NULL
                        CHECK (document_role IN (
                          'quote',                -- supplier quote at submission
                          'pro_forma_invoice',
                          'screenshot',           -- e.g. WhatsApp price screenshot
                          'authorisation',        -- CEO email approval / printed sign-off
                          'bank_transfer_receipt', -- proof of disbursement transfer
                          'settlement_receipt',   -- receipt showing how the money was spent
                          'other'
                        )),
  uploaded_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                 TEXT,
  UNIQUE (cash_request_id, document_id, document_role)
);
CREATE INDEX idx_cash_request_documents_request
  ON shared.cash_request_documents (cash_request_id);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ cash_request_settlements                                           ║
-- ║ For cash ADVANCES: each receipt of what the money was spent on.    ║
-- ║ When sum(receipts) + cash_returned = amount_disbursed, the         ║
-- ║ request flips to 'settled'. Shortfall → payroll deduction.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.cash_request_settlements (
  settlement_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_request_id       UUID        NOT NULL REFERENCES shared.cash_requests (cash_request_id) ON DELETE CASCADE,
  -- One row per receipt OR per cash-returned event
  entry_type            TEXT        NOT NULL
                        CHECK (entry_type IN ('receipt','cash_returned','foreign_fx_adjustment')),
  -- The amount this entry settles
  amount_ngn            NUMERIC(14,2) NOT NULL CHECK (amount_ngn > 0),
  -- For receipts: link the supporting document
  document_id           UUID        REFERENCES shared.documents (document_id) ON DELETE SET NULL,
  -- Vendor / who-paid
  paid_to               TEXT,
  paid_on               DATE,
  description           TEXT,
  -- For 'cash_returned': how it came back
  return_method         TEXT        CHECK (return_method IN ('cash','bank_transfer','offset_advance',NULL)),
  bank_transaction_id   TEXT,                                   -- if return_method='bank_transfer'
  -- Audit
  recorded_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_request_settlements_request
  ON shared.cash_request_settlements (cash_request_id, recorded_at);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ business_config: add CEO threshold for Cash Request                ║
-- ║ Spec: "optional CEO-skip threshold; default ₦20,000".             ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.business_config
  ADD COLUMN cash_request_settings JSONB NOT NULL DEFAULT '{
    "ceo_approval_threshold_ngn": 20000,
    "settlement_required_by_days": 14,
    "auto_deduct_unsettled_via_payroll": true,
    "categories": [
      "office_supplies",
      "petty_cash_topup",
      "vendor_deposit",
      "staff_reimbursement",
      "travel_advance",
      "event_logistics",
      "emergency",
      "other"
    ]
  }'::jsonb;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ Document numbering — add CR sequence per brand                     ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Note: per-brand seeds for the sequence are added in template/000035.

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ State-transition + bank-reference guard trigger                    ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_cash_request_log_state()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO shared.cash_request_state_history
      (cash_request_id, from_status, to_status,
       changed_by, changed_at,
       amount_snapshot_ngn, decision_snapshot)
    VALUES
      (NEW.cash_request_id, OLD.status, NEW.status,
       COALESCE(NEW.disbursed_by, NEW.ceo_decided_by, NEW.finance_reviewed_by, NEW.submitted_by),
       now(),
       NEW.amount_requested_ngn,
       CASE NEW.status
         WHEN 'pending_ceo'   THEN NEW.finance_decision
         WHEN 'approved'      THEN COALESCE(NEW.ceo_decision, NEW.finance_decision)
         WHEN 'rejected'      THEN COALESCE(NEW.ceo_decision, NEW.finance_decision)
         WHEN 'sent_back'     THEN COALESCE(NEW.ceo_decision, NEW.finance_decision)
         ELSE NULL
       END);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cash_request_log_state
  AFTER UPDATE OF status ON shared.cash_requests
  FOR EACH ROW EXECUTE FUNCTION shared.fn_cash_request_log_state();

-- Initial state row on insert
CREATE OR REPLACE FUNCTION shared.fn_cash_request_initial_state()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO shared.cash_request_state_history
    (cash_request_id, from_status, to_status, changed_by, changed_at, amount_snapshot_ngn)
  VALUES
    (NEW.cash_request_id, NULL, NEW.status, NEW.submitted_by, now(), NEW.amount_requested_ngn);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cash_request_initial_state
  AFTER INSERT ON shared.cash_requests
  FOR EACH ROW EXECUTE FUNCTION shared.fn_cash_request_initial_state();

-- ============================================================
-- After this migration: shared schema gains 4 new tables
-- (cash_requests, cash_request_state_history, cash_request_documents,
--  cash_request_settlements)
-- ============================================================
