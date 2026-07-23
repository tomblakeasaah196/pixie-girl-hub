-- ============================================================
-- 000366_shared_order_lifecycle_comms
--
-- Two new Communications Studio automations that replace a hardcoded,
-- factually-wrong email: src/services/order-confirmation-email.js fired at
-- order PLACEMENT (order.created) but unconditionally claimed "we've
-- received your payment... it's now confirmed" — true for nobody at that
-- moment, since every order is created pending_payment regardless of
-- channel. It also wasn't Comms-Studio-editable beyond an intro/signoff line.
--
--   order_placement          — fires on order.created. Honest about what's
--     actually true at that moment: the order request is logged, an invoice
--     (proforma) is attached/linked, payment is what's still needed. Luxury
--     brand-voice copy per owner direction (2026-07-23 session).
--   order_paid_confirmation  — fires on order.paid — the ACTUAL payment
--     confirmation, gated to the real webhook/full-payment event. This is
--     the message that gets to say "payment confirmed."
--
-- payment_received (order.payment_recorded, seeded by 000315) already covers
-- the "acknowledge every partial/deposit payment" leg — no change needed
-- there, it already fires on every instalment.
--
-- All copy is editable in the Studio afterward; ON CONFLICT DO NOTHING
-- preserves any operator customisation on re-run.
-- ============================================================

BEGIN;

WITH studio_defaults (
  event_key, display_name, description, category, trigger_type, cadence_config,
  subject_template, preheader_template, email_blocks_json,
  whatsapp_body_template, variables_schema
) AS (VALUES

  ('order_placement', 'Order Placed — Awaiting Payment',
   'Fires the moment an order is placed (every channel: storefront, order-link/WhatsApp/Instagram, Sales Campaign, POS). Acknowledges the request and attaches the proforma invoice with a secure payment link — never claims payment was received, since none has been yet.',
   'transactional', 'event',
   '{"type":"event","event":"order.created"}'::jsonb,
   'Your Selection Is Beautifully Captured — Order {{order_number}}',
   'Complete your payment to lock in your unit and begin fulfillment.',
   '[
     {"type":"eyebrow","text":"YOUR ORDER REQUEST"},
     {"type":"heading","text":"Your selection for {{item_name}} has been beautifully captured."},
     {"type":"paragraph","html":"Your order request <strong>{{order_number}}</strong> is officially logged."},
     {"type":"paragraph","html":"Because our luxury pixies are meticulously crafted and inventory moves swiftly, please complete your payment of <strong>{{total}}</strong> via the secure link below to lock in your unit and initiate fulfillment."},
     {"type":"button","label":"Secure Payment Link","href":"{{pay_url}}"},
     {"type":"divider"},
     {"type":"paragraph","html":"Your invoice for this order is attached for your records.","muted":true}
   ]'::jsonb,
   'Hi {{first_name}}! Your selection for {{item_name}} has been beautifully captured — order {{order_number}} is officially logged. Because our luxury pixies are meticulously crafted and inventory moves swiftly, please complete your payment of {{total}} to lock in your unit and initiate fulfillment.\n\nPay securely: {{pay_url}}\nView your invoice: {{invoice_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"FLH-SO-0093"},{"name":"item_name","example":"Classic Full Frontal Spicy Copper"},{"name":"total","example":"₦389,000.00"},{"name":"pay_url","example":"https://…/pay/abc123"},{"name":"invoice_url","example":"https://…/invoices/faitlynhair/…/view"},{"name":"brand_name","example":"Faitlyn Hair"}]'::jsonb),

  ('order_paid_confirmation', 'Payment Confirmed',
   'The genuine payment-confirmation letter — fires ONLY on order.paid (a real webhook/full-payment event), never at placement. Says "payment confirmed" because, at this point, it actually is.',
   'transactional', 'event',
   '{"type":"event","event":"order.paid"}'::jsonb,
   'Payment Confirmed — Order {{order_number}} 🌹',
   'Your payment has been received and your order is confirmed.',
   '[
     {"type":"eyebrow","text":"PAYMENT CONFIRMED"},
     {"type":"heading","text":"Thank you, {{first_name}} — your order is on its way to being made real."},
     {"type":"paragraph","html":"We''ve received your payment of <strong>{{total}}</strong> for order <strong>{{order_number}}</strong>, and it is now fully confirmed."},
     {"type":"paragraph","html":"Every piece is chosen and packed with care — thank you for letting {{brand_name}} be part of your story."},
     {"type":"button","label":"View your invoice","href":"{{invoice_url}}"}
   ]'::jsonb,
   'Thank you {{first_name}}! We''ve received your payment of {{total}} for order {{order_number}} — it''s now fully confirmed. Every piece is chosen and packed with care. View your invoice: {{invoice_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"FLH-SO-0093"},{"name":"total","example":"₦389,000.00"},{"name":"invoice_url","example":"https://…/invoices/faitlynhair/…/view"},{"name":"brand_name","example":"Faitlyn Hair"}]'::jsonb)

)
INSERT INTO shared.outbound_channel_policy
  (business, event_key, channel_preference, fallback_channel, rationale,
   block_whatsapp, is_active,
   display_name, description, category, trigger_type, cadence_config,
   subject_template, preheader_template, email_blocks_json,
   whatsapp_body_template, variables_schema)
SELECT bc.business_key, s.event_key,
       'email'     AS channel_preference,
       'whatsapp'  AS fallback_channel,
       'Managed via Communications Studio.' AS rationale,
       false       AS block_whatsapp,
       true        AS is_active,
       s.display_name, s.description, s.category, s.trigger_type, s.cadence_config,
       s.subject_template, s.preheader_template, s.email_blocks_json,
       s.whatsapp_body_template, s.variables_schema
  FROM shared.business_config bc
  CROSS JOIN studio_defaults s
 WHERE bc.is_active = true
ON CONFLICT (business, event_key) DO NOTHING;

COMMIT;

-- ============================================================
-- Verify:
--   SELECT event_key, channel_preference, fallback_channel, is_active
--     FROM shared.outbound_channel_policy
--    WHERE event_key IN ('order_placement','order_paid_confirmation')
--    ORDER BY business, event_key;
-- ============================================================
