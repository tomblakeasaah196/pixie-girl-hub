-- ============================================================
-- MIGRATION 000381 — Post-hoc coupon: timeline event code
-- Pixie Girl Hub · V2.2 §6.2 / §6.23.2
--
-- Seeds the `discount_applied` timeline event code so a coupon applied AFTER
-- an order was placed shows up on the customer-facing order tracker alongside
-- "Payment Received" and "Order Updated".
--
-- Background: a customer eligible for a code that nobody entered at checkout
-- had no repair path. Cancelling and re-raising forfeits her deposit to Other
-- Income (policy Q7) and burns the order number; Change Order deliberately
-- carries existing discounts forward rather than granting new ones. So the
-- Record Payment form now takes a code directly, applies it to the order in
-- place, and reconciles the invoice, the GL and the coupon ledger in one
-- transaction — see src/modules/sales/order-coupon.service.js.
--
-- The waiver is capped at the order's outstanding balance (owner decision), so
-- it can settle an order but never drive it into credit.
--
-- No table changes: sales_order_discounts, shared.coupons and
-- shared.coupon_redemptions already model everything this writes. The only new
-- persistent artefact is this dictionary row, which order_timeline_events
-- references by code.
--
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO shared.timeline_event_codes
  (code, default_label, applies_to_order_types, stage_group,
   default_customer_visible, display_order, is_system_code)
VALUES
  ('discount_applied', 'Discount Applied',
   '{physical,custom,service,subscription}', 'ordered', true, 36, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT code, default_label, display_order
--     FROM shared.timeline_event_codes
--    WHERE code = 'discount_applied';
--   -- expected: one row, 'Discount Applied', 36
-- ============================================================
