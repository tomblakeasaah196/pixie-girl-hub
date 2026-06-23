-- ============================================================
-- MIGRATION 000236 — Goods Reception receiver name
--
-- The simplified "Goods Reception" flow (Stock → Receive) records WHO
-- physically received the stock. The user id is already captured in
-- inbound_shipments.created_by; this adds a human-readable receiver name
-- (defaulted to the logged-in user, editable) so the receiving register can
-- show a friendly name alongside the id without a users join.
--
-- Applies to every brand schema + the template (000017) carries it for fresh
-- provisioning. Idempotent.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'inbound_shipments'
       AND table_schema NOT IN ('template')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.inbound_shipments ADD COLUMN IF NOT EXISTS received_by_name TEXT',
      r.s
    );
  END LOOP;
END $$;
