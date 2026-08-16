-- ============================================================
-- 000380_shared_order_amended_comms
--
-- One new Communications Studio automation: `order_amended`.
--
-- When staff change an order after it was placed (the "we recorded the wrong
-- product" repair — see docs/ORDER_AMENDMENTS.md), the customer must hear it
-- from us before she hears it from the courier. This is that letter: what
-- changed, what the order now totals, and — when the swap costs more — the
-- secure link to settle the difference.
--
-- It is deliberately ONE message covering both directions:
--   • balance owed  → "{{difference}} more to complete" + pay link
--   • credit due    → "{{difference}} will come back to you"
--   • no change     → item/delivery correction only
-- The service passes `difference_label` / `balance_line` already worded, so
-- the operator can restructure the copy without the backend having to know
-- which sentence to hide.
--
-- Fires from src/modules/sales/amendment.service.js (post-commit, via the
-- transactional outbox), deduped per AMENDMENT — a second change to the same
-- order sends a second letter, which is correct.
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

  ('order_amended', 'Order Updated — Change Confirmed',
   'Fires when staff amend an existing order from Sales → Orders → Change Order (items swapped, quantity changed, or delivery details corrected). Tells the customer exactly what changed and what she now owes — or what is coming back to her. Never fires for an untouched order.',
   'transactional', 'event',
   '{"type":"event","event":"order.amended"}'::jsonb,
   'Your Order {{order_number}} Has Been Updated',
   'Here is what changed — and what happens next.',
   '[
     {"type":"eyebrow","text":"ORDER UPDATED"},
     {"type":"heading","text":"{{first_name}}, we have updated your order."},
     {"type":"paragraph","html":"Order <strong>{{order_number}}</strong> has been amended. Here is exactly what changed:"},
     {"type":"paragraph","html":"{{change_summary}}"},
     {"type":"divider"},
     {"type":"paragraph","html":"Your new order total is <strong>{{total}}</strong>. {{difference_label}}"},
     {"type":"paragraph","html":"{{balance_line}}"},
     {"type":"button","label":"Complete Your Payment","href":"{{pay_url}}"},
     {"type":"divider"},
     {"type":"paragraph","html":"Your updated invoice is available here: <a href=\"{{invoice_url}}\">{{invoice_url}}</a>","muted":true},
     {"type":"paragraph","html":"If anything above is not what you expected, reply to this message and we will put it right straight away.","muted":true}
   ]'::jsonb,
   'Hi {{first_name}} — we have updated your order {{order_number}}.\n\n{{change_summary}}\n\nNew total: {{total}}. {{difference_label}}\n{{balance_line}}\n\nComplete your payment: {{pay_url}}\nYour updated invoice: {{invoice_url}}\n\nIf anything is not what you expected, just reply and we will put it right.',
   '[{"name":"first_name","example":"Adaeze"},
     {"name":"order_number","example":"FLH-SO-0093"},
     {"name":"change_summary","example":"Removed: Classic Full Frontal — Black ×1. Added: Styled Bodywave Copper — Medium ×1."},
     {"name":"total","example":"₦520,000.00"},
     {"name":"difference_label","example":"That is ₦131,000.00 more than before."},
     {"name":"balance_line","example":"₦131,000.00 is outstanding — please complete it with the secure link below."},
     {"name":"pay_url","example":"https://…/pay/abc123"},
     {"name":"invoice_url","example":"https://…/invoices/faitlynhair/…/view"},
     {"name":"brand_name","example":"Faitlyn Hair"}]'::jsonb)

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
--   SELECT business, event_key, channel_preference, is_active
--     FROM shared.outbound_channel_policy
--    WHERE event_key = 'order_amended'
--    ORDER BY business;
-- ============================================================
