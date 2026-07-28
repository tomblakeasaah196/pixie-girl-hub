-- ============================================================
-- 000369 — Seed the MISSING stock document-numbering sequences.
--
-- ROOT CAUSE OF "EVERY ORDER BECOMES A PRE-ORDER, EVEN WITH STOCK ON HAND".
--
-- stock.repo.nextMovementNumber called <brand>.fn_next_document_number(
-- 'stock_movement') to number every row it writes to stock_movements. That
-- function RAISEs when shared.document_numbering has no row for
-- (business, document_type):
--
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'No document_numbering row for (<brand>, %)', ...
--
-- and NOTHING in this codebase ever seeded 'stock_movement' — the string
-- appeared exactly once, at the call site. So:
--
--   recordMovement -> RAISE -> reserveForOrder throws -> createOrder rolls back
--   its per-line reserve savepoint -> the line is recorded as a PRE-ORDER.
--
-- Every line, every order, every channel, regardless of stock. stock_levels
-- .reserved therefore never moved off zero and stock_movements stayed empty,
-- which also meant paid orders never deducted. The pre-order fallback swallowed
-- the RAISE as a routine stock-out, so it never surfaced as an error.
--
-- The code fix routes both stock numbering helpers through the guarded
-- shared/numbering/document-number.js (SAVEPOINT + provision + retry), which
-- self-heals on first use. This migration provisions the rows up front so the
-- very first order after deploy is already correct, and so the sequences are
-- visible in Settings -> Document Numbering rather than appearing by surprise.
--
-- Idempotent: ON CONFLICT DO NOTHING, so an already-provisioned brand (or a
-- re-run) is a no-op and existing numbering is never rewritten.
-- ============================================================

DO $$
DECLARE
  r        RECORD;
  v_type   TEXT;
  v_suffix TEXT;
BEGIN
  -- Every stock document type that reaches fn_next_document_number, paired with
  -- its house suffix (matches DOC_SUFFIX in shared/numbering/document-number.js).
  FOR r IN SELECT business_key, document_prefix FROM shared.business_config LOOP
    FOREACH v_type IN ARRAY ARRAY[
      'stock_movement', 'stock_transfer', 'stock_adjustment', 'stock_count'
    ] LOOP
      v_suffix := CASE v_type
                    WHEN 'stock_movement'   THEN 'MOV'
                    WHEN 'stock_transfer'   THEN 'TRF'
                    WHEN 'stock_adjustment' THEN 'ADJ'
                    WHEN 'stock_count'      THEN 'CNT'
                  END;

      INSERT INTO shared.document_numbering
        (business, document_type, prefix, padding, next_number)
      VALUES
        (r.business_key, v_type, r.document_prefix || '-' || v_suffix, 4, 1)
      ON CONFLICT (business, document_type) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- Verify:
--   SELECT business, document_type, prefix, next_number
--     FROM shared.document_numbering
--    WHERE document_type LIKE 'stock_%'
--    ORDER BY business, document_type;
--   -- expect 4 rows per business, e.g. ('faitlynhair','stock_movement','FLH-MOV',1)
--
-- Then a Quick Sale of an in-stock item must produce a movement:
--   SELECT movement_number, movement_type, quantity
--     FROM faitlynhair.stock_movements
--    WHERE reference_type = 'sales_order'
--    ORDER BY performed_at DESC LIMIT 5;   -- expect FLH-MOV-0001, 'reserve', 1
-- ============================================================
