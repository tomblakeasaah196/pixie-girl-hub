-- ============================================================
-- MIGRATION 000254 — Drop cash-request state-history triggers
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- shared.cash_requests carried two triggers that logged to
-- cash_request_state_history automatically:
--   • trg_cash_request_initial_state  (AFTER INSERT)
--   • trg_cash_request_log_state      (AFTER UPDATE OF status)
--
-- But the service layer (cash-request.service.js) ALSO writes a history row
-- explicitly on create() and on every transition() — and that app-level write
-- is richer: it records the acting user, decision notes, and decision snapshot.
-- The result was every transition being logged twice, so the request timeline
-- showed each stage duplicated ("Draft, Draft, Pending Finance, Pending
-- Finance").
--
-- The app-layer write is the source of truth (it powers audit + events too), so
-- we drop the triggers and their functions. All status changes flow through the
-- service, so nothing is left unlogged.
-- ============================================================

DROP TRIGGER IF EXISTS trg_cash_request_initial_state ON shared.cash_requests;
DROP TRIGGER IF EXISTS trg_cash_request_log_state ON shared.cash_requests;
DROP FUNCTION IF EXISTS shared.fn_cash_request_initial_state();
DROP FUNCTION IF EXISTS shared.fn_cash_request_log_state();

-- Clean up the duplicates the triggers already created. The trigger row and the
-- service row for the same transition land in the same transaction (same
-- second), so we collapse rows that share (request, from, to, second) and keep
-- the richest one — preferring a row that actually carries notes/decision, then
-- the earliest ctid. Genuinely repeated stages (e.g. a request sent back and
-- re-submitted days later) differ in changed_at and are preserved.
DELETE FROM shared.cash_request_state_history h
 USING (
   SELECT ctid,
          row_number() OVER (
            PARTITION BY cash_request_id, from_status, to_status,
                         date_trunc('second', changed_at)
            ORDER BY (notes IS NOT NULL OR decision_snapshot IS NOT NULL) DESC,
                     changed_at ASC, ctid ASC
          ) AS rn
     FROM shared.cash_request_state_history
 ) dup
 WHERE h.ctid = dup.ctid
   AND dup.rn > 1;
