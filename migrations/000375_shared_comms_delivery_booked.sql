-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000375 — Communications Studio: the "Delivery Booked" automation      ║
-- ║                                                                      ║
-- ║ Until now the customer heard nothing between "we've got your money"   ║
-- ║ and "your order shipped" — the courier hand-off. Booking a courier    ║
-- ║ (Logistics → Book delivery) wrote the waybill, the agreed fee, the    ║
-- ║ pickup window and the rider's phone number onto the delivery, and     ║
-- ║ told the customer none of it. This seeds the automation that closes   ║
-- ║ that gap: shipper name, waybill/AWB, pickup + expected-delivery       ║
-- ║ window, rider contact, and the tracking link.                        ║
-- ║                                                                      ║
-- ║ Distinct from `order_shipped`, deliberately:                          ║
-- ║   delivery_booked → "a courier is assigned, here are the details"     ║
-- ║   order_shipped   → "the courier physically has it" (picked_up)       ║
-- ║ Both can be toggled independently from the Studio.                    ║
-- ║                                                                      ║
-- ║ Idempotent: INSERT … ON CONFLICT DO UPDATE refreshes studio metadata  ║
-- ║ only where the row still carries the empty seed, exactly like 000309. ║
-- ║ An operator's channel_preference / block_whatsapp is never touched.   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

WITH studio_defaults(event_key, display_name, description, category, trigger_type,
                     cadence_config, subject_template, preheader_template,
                     email_blocks_json, whatsapp_body_template, variables_schema) AS (VALUES

  ('delivery_booked', 'Delivery Booked',
   'Sent when a courier is booked for the order. Carries the shipper, the waybill/tracking reference, the pickup and expected-delivery window, and the rider''s contact where one is recorded.',
   'transactional', 'event',
   '{"type":"event","event":"delivery.booked"}'::jsonb,
   'Order {{order_number}} is booked with {{courier_name}}',
   'Your delivery details from {{brand_name}}.',
   '[
     {"type":"eyebrow","text":"DELIVERY BOOKED"},
     {"type":"heading","text":"Order {{order_number}} is booked"},
     {"type":"paragraph","html":"Hi {{first_name}}, we''ve booked your delivery with <strong>{{courier_name}}</strong>. Here are the details so you know exactly what to expect."},
     {"type":"paragraph","html":"{{shipment_details_html}}"},
     {"type":"button","label":"Track your delivery","href":"{{tracking_url}}"},
     {"type":"paragraph","html":"{{courier_tracking_html}}","muted":true},
     {"type":"divider"},
     {"type":"paragraph","html":"If any of the details above look wrong, reply to this email and we''ll fix it before pickup.","muted":true}
   ]'::jsonb,
   '{{brand_name}}: order {{order_number}} is booked with {{courier_name}}.{{shipment_details_text}} Track: {{tracking_url}}',
   '[{"name":"first_name","example":"Adaeze"},
     {"name":"order_number","example":"FLH-SO-1024"},
     {"name":"courier_name","example":"GIG Logistics"},
     {"name":"tracking_ref","example":"AWB-889213"},
     {"name":"expected_delivery_text","example":"12 August 2026"},
     {"name":"pickup_text","example":"11 August 2026, 09:00"},
     {"name":"driver_text","example":"Musa Bello · 0803 000 0000"},
     {"name":"shipment_details_html","example":"<strong>Waybill:</strong> AWB-889213<br/><strong>Expected:</strong> 12 August 2026"},
     {"name":"shipment_details_text","example":" Waybill AWB-889213, expected 12 August 2026."},
     {"name":"courier_tracking_html","example":"Track directly with GIG Logistics: <a href=\"https://…\">https://…</a>"},
     {"name":"tracking_url","example":"https://…"}]'::jsonb)
)
INSERT INTO shared.outbound_channel_policy
  (business, event_key, channel_preference, fallback_channel, rationale,
   block_whatsapp, is_active,
   display_name, description, category, trigger_type, cadence_config,
   subject_template, preheader_template, email_blocks_json,
   whatsapp_body_template, variables_schema)
SELECT bc.business_key, s.event_key,
       -- Email by default, same cost discipline as every other automation:
       -- nothing rides WhatsApp until the CEO picks it in the Studio.
       'email'                              AS channel_preference,
       'email'                              AS fallback_channel,
       'Managed via Communications Studio.' AS rationale,
       false                                AS block_whatsapp,
       true                                 AS is_active,
       s.display_name, s.description, s.category, s.trigger_type, s.cadence_config,
       s.subject_template, s.preheader_template, s.email_blocks_json,
       s.whatsapp_body_template, s.variables_schema
  FROM shared.business_config bc
  CROSS JOIN studio_defaults s
  WHERE bc.is_active = true
ON CONFLICT (business, event_key) DO UPDATE SET
  -- Operator choices (channel_preference / fallback_channel / block_whatsapp /
  -- is_active) are never overwritten. Studio metadata and template DEFAULTS are
  -- refreshed only where the row still carries the empty seed.
  display_name           = COALESCE(shared.outbound_channel_policy.display_name,           EXCLUDED.display_name),
  description            = COALESCE(shared.outbound_channel_policy.description,            EXCLUDED.description),
  category               = COALESCE(shared.outbound_channel_policy.category,               EXCLUDED.category),
  trigger_type           = COALESCE(shared.outbound_channel_policy.trigger_type,           EXCLUDED.trigger_type),
  cadence_config         = CASE WHEN shared.outbound_channel_policy.cadence_config = '{}'::jsonb
                                THEN EXCLUDED.cadence_config
                                ELSE shared.outbound_channel_policy.cadence_config END,
  subject_template       = COALESCE(shared.outbound_channel_policy.subject_template,       EXCLUDED.subject_template),
  preheader_template     = COALESCE(shared.outbound_channel_policy.preheader_template,     EXCLUDED.preheader_template),
  email_blocks_json      = CASE WHEN shared.outbound_channel_policy.email_blocks_json = '[]'::jsonb
                                THEN EXCLUDED.email_blocks_json
                                ELSE shared.outbound_channel_policy.email_blocks_json END,
  whatsapp_body_template = COALESCE(shared.outbound_channel_policy.whatsapp_body_template, EXCLUDED.whatsapp_body_template),
  variables_schema       = CASE WHEN shared.outbound_channel_policy.variables_schema = '[]'::jsonb
                                THEN EXCLUDED.variables_schema
                                ELSE shared.outbound_channel_policy.variables_schema END,
  updated_at             = now();

COMMIT;
