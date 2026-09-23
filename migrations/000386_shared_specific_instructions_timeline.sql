-- ============================================================
-- MIGRATION 000386 — Specific Instructions timeline event
-- Pixie Girl Hub · Specific Instructions feature (Q4 C)
--
-- Seeds `specific_instructions_updated` timeline event code so an
-- edit to sales_orders.specific_instructions shows up on the
-- customer-facing tracker and the admin OrderDetailPage timeline.
-- Internal only (Q5=A): customer_payload is empty, internal_payload
-- carries the new text. Not customer-visible by default — Studio
-- needs to see it, customer tracker doesn't.
--
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO shared.timeline_event_codes
  (code, default_label, applies_to_order_types, stage_group,
   default_customer_visible, display_order, is_system_code)
VALUES
  ('specific_instructions_updated', 'Specific Instructions Updated',
   '{physical,custom,service,subscription}', 'ordered', false, 37, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT code, default_label FROM shared.timeline_event_codes
--    WHERE code = 'specific_instructions_updated';
-- ============================================================
