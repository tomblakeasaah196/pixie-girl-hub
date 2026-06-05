-- ============================================================
-- MIGRATION 000202 — Cross-schema soft FK reconciliation (C-3)
-- Pixie Girl Hub · JBS Praxis · Conformance pass V2.2
--
-- Background:
--   Many shared tables reference per-brand rows by UUID without a hard FK
--   (because the target lives in one of two schemas). Examples:
--     • shared.documents.reference_id  → {brand}.<entity>
--     • shared.cash_requests.linked_*  → {brand}.<entity>
--     • shared.signature_requests.reference_id → {brand}.<entity>
--     • shared.ai_pending_actions.target_id → {brand}.<entity>
--
-- Risk: orphan rows when the per-brand target is deleted.
--
-- Approach:
--   1. Define a registry table that lists every (source_schema, source_table,
--      source_column, target_schema_pattern, target_table) soft-FK pair.
--   2. Provide a function shared.fn_reconcile_soft_fks() that iterates the
--      registry, runs each check, and writes findings to a result table.
--   3. Nightly cron job in the app calls this function.
--
-- This migration creates the registry + result table + function.
-- The actual app-layer cron wiring is documented in
-- backend/src/jobs/schedulers/soft-fk-reconciliation.js (TODO).
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ REGISTRY — declarative list of soft-FK pairs                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.soft_fk_registry (
  registry_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source (the table with the soft FK column)
  source_schema         TEXT        NOT NULL,
  source_table          TEXT        NOT NULL,
  source_column         TEXT        NOT NULL,
  -- Discriminator column on the source (e.g. 'business' or 'reference_type')
  source_discriminator_column TEXT,
  source_discriminator_value  TEXT,
  -- Target (the table the column references)
  -- Use '{business}' as placeholder where the actual brand goes
  target_schema_pattern TEXT        NOT NULL,                   -- '{business}' or 'shared'
  target_table          TEXT        NOT NULL,
  target_column         TEXT        NOT NULL DEFAULT 'id',      -- usually the PK
  -- Reconciliation policy
  on_orphan_action      TEXT        NOT NULL DEFAULT 'flag'
                        CHECK (on_orphan_action IN ('flag','soft_delete_source','notify_only')),
  notify_role           TEXT,                                   -- e.g. 'finance'
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  notes                 TEXT,
  registered_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique on the discriminated combination (PG doesn't allow expressions
-- in inline UNIQUE constraints, but does on unique indexes)
CREATE UNIQUE INDEX uniq_soft_fk_registry
  ON shared.soft_fk_registry
    (source_schema, source_table, source_column, COALESCE(source_discriminator_value, ''));

CREATE INDEX idx_soft_fk_registry_active
  ON shared.soft_fk_registry (source_schema, source_table)
  WHERE is_active = true;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ RECONCILIATION RUNS — historical record of each sweep              ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.soft_fk_reconciliation_runs (
  run_id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ,
  status                TEXT        NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','complete','failed')),
  total_pairs_checked   INTEGER,
  total_orphans_found   INTEGER,
  error_message         TEXT
);

CREATE TABLE shared.soft_fk_reconciliation_findings (
  finding_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID        NOT NULL REFERENCES shared.soft_fk_reconciliation_runs (run_id) ON DELETE CASCADE,
  registry_id           UUID        NOT NULL REFERENCES shared.soft_fk_registry (registry_id) ON DELETE CASCADE,
  -- The orphaned row
  source_row_pk         TEXT        NOT NULL,                   -- stringified PK for portability
  missing_target_id     UUID        NOT NULL,
  resolution_status     TEXT        NOT NULL DEFAULT 'open'
                        CHECK (resolution_status IN ('open','acknowledged','resolved','false_positive')),
  resolved_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  resolved_at           TIMESTAMPTZ,
  resolution_notes      TEXT,
  found_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_soft_fk_findings_open
  ON shared.soft_fk_reconciliation_findings (registry_id, found_at)
  WHERE resolution_status = 'open';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ SEED THE REGISTRY                                                  ║
-- ║ The most important soft-FK pairs we already know about.            ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.soft_fk_registry
  (source_schema, source_table, source_column,
   source_discriminator_column, source_discriminator_value,
   target_schema_pattern, target_table, target_column,
   on_orphan_action, notes)
VALUES
  -- shared.documents.reference_id → various per-brand tables
  ('shared','documents','reference_id', 'reference_type', 'sales_order',
   '{business}','sales_orders','order_id', 'flag',
   'Document attached to a sales_order; if order deleted, document is orphaned'),
  ('shared','documents','reference_id', 'reference_type', 'purchase_order',
   '{business}','purchase_orders','po_id', 'flag', NULL),
  ('shared','documents','reference_id', 'reference_type', 'production_run',
   '{business}','production_runs','production_run_id', 'flag', NULL),
  -- shared.cash_requests linked references
  ('shared','cash_requests','linked_expense_id', NULL, NULL,
   '{business}','expenses','expense_id', 'flag', NULL),
  ('shared','cash_requests','linked_supplier_invoice_id', NULL, NULL,
   '{business}','supplier_invoices','supplier_invoice_id', 'flag', NULL),
  ('shared','cash_requests','linked_journal_entry_id', NULL, NULL,
   '{business}','journal_entries','journal_id', 'flag', NULL),
  -- shared.signature_requests.reference_id → various
  ('shared','signature_requests','reference_id', 'reference_type', 'stylist_partner_agreement',
   '{business}','stylist_partners','stylist_id', 'flag', NULL),
  -- shared.ai_pending_actions
  ('shared','ai_pending_actions','target_id', 'target_type', 'sales_order',
   '{business}','sales_orders','order_id', 'flag', NULL);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ THE RECONCILIATION FUNCTION                                        ║
-- ║                                                                    ║
-- ║ Called by the nightly cron. Returns the run_id so the caller can   ║
-- ║ check findings.                                                    ║
-- ║                                                                    ║
-- ║ Implementation note: instead of generating dynamic SQL for every   ║
-- ║ registry row (complex + slow), this function exposes the data the  ║
-- ║ app's reconciler service needs and the actual joins are done in    ║
-- ║ JS where retries + error handling are easier.                      ║
-- ║                                                                    ║
-- ║ For now this is a stub that records the run; the iterative check   ║
-- ║ is in src/jobs/schedulers/soft-fk-reconciliation.js (app layer).   ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_soft_fk_reconciliation_start()
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_run_id UUID;
  v_pair_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pair_count
    FROM shared.soft_fk_registry WHERE is_active = true;

  INSERT INTO shared.soft_fk_reconciliation_runs
    (status, total_pairs_checked)
  VALUES ('running', v_pair_count)
  RETURNING run_id INTO v_run_id;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION shared.fn_soft_fk_reconciliation_finish(
  p_run_id UUID,
  p_orphans_found INTEGER,
  p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shared.soft_fk_reconciliation_runs
     SET status            = CASE WHEN p_error_message IS NULL THEN 'complete' ELSE 'failed' END,
         finished_at       = now(),
         total_orphans_found = p_orphans_found,
         error_message     = p_error_message
   WHERE run_id = p_run_id;
END;
$$;

-- ============================================================
-- After this migration: shared schema gains 3 new tables
--   • soft_fk_registry
--   • soft_fk_reconciliation_runs
--   • soft_fk_reconciliation_findings
-- + 2 helper functions for the nightly cron
-- + 8 seed rows registering the most critical soft-FK pairs
-- ============================================================
