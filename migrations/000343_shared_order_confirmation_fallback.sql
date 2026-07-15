-- ============================================================
-- MIGRATION 000343 — Order confirmation: WhatsApp fallback for no-email customers
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Owner directive (2026-07-15): every confirmed (paid) order must produce a
-- branded confirmation message, whatever channel the order came from.
-- Email-holding customers get the premium confirmation letter; customers
-- with NO email on file (the common case for WhatsApp / Instagram
-- order-link checkouts, which only require a phone) previously got nothing
-- — the 'order_confirmation' Comms Studio automation existed but was never
-- dispatched, and its channel default is 'email'.
--
-- The order.paid subscriber now dispatches 'order_confirmation' for
-- no-email contacts, and the dispatcher falls back to the policy's OWN
-- fallback_channel when the preferred channel has no address on the
-- contact. This migration configures that fallback to WhatsApp so the
-- confirmation actually reaches messaging-first customers. Transactional,
-- tied to a purchase the customer just made — not marketing — and the CEO
-- can change or disable it any time in Communications Studio.
--
-- block_whatsapp remains authoritative: rows with block_whatsapp = true
-- are left untouched (the dispatcher refuses the WhatsApp fallback for
-- them regardless).
--
-- Idempotent: the WHERE clause only touches rows still on the empty default.
-- ============================================================

UPDATE shared.outbound_channel_policy
   SET fallback_channel = 'whatsapp',
       updated_at = now()
 WHERE event_key = 'order_confirmation'
   AND block_whatsapp IS DISTINCT FROM true
   AND (fallback_channel IS NULL OR fallback_channel = '');
