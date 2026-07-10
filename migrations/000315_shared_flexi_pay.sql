-- ============================================================
-- 000315 — Flexi Pay (partial payments) shared config + automations
-- Pixie Girl Hub · JBS Praxis · V2.2 §6.2 (owner session 2026-07-10)
--
-- 1) installment_settings gains the Flexi Pay policy keys. The defaults are
--    merged UNDER the existing JSON (existing operator values always win) so
--    re-running is harmless and no operator choice is ever clobbered.
--    These keys are the single source of truth the Sales → Payments admin
--    tab (PR-3) edits and every checkout reads. Nothing is hardcoded.
--
-- 2) Three Communications Studio automations are seeded per business:
--      payment_received   — receipt after every part-payment (balance + link)
--      payment_milestone  — celebration when payments cross 50%
--      abandoned_checkout — one-time nudge for a checkout that never paid
--    All copy is editable in the Studio; ON CONFLICT DO NOTHING preserves
--    any operator-customised rows.
-- ============================================================

-- ── 1) Flexi Pay policy defaults ─────────────────────────────
UPDATE shared.business_config
   SET installment_settings = '{
     "plan_display_name": "Flexi Pay",
     "plan_terms": [
       "Your items are reserved for you the moment you pay your first instalment.",
       "Pay at your own pace — any amount, anytime, using your personal payment link.",
       "Your order ships as soon as it is fully paid.",
       "If we receive no payment for 60 days the order is cancelled and the reservation is released."
     ],
     "min_first_payment_pct": 30,
     "min_topup_ngn": 1000,
     "custom_order_deposit_pct": 50,
     "default_deposit_pct_for_deposit_triggered": 50,
     "layaway_abandonment_days": 60,
     "layaway_reminder_cadence_days": 7,
     "auto_cancel_after_no_payment": true,
     "abandoned_checkout_nudge_enabled": true,
     "abandoned_checkout_nudge_hours": 2,
     "abandoned_checkout_expiry_hours": 48,
     "milestone_messages_enabled": true,
     "channels": {
       "storefront": true,
       "public_form": true,
       "whatsapp": true,
       "instagram": true,
       "walk_in": true,
       "event": true,
       "sales_campaign": true
     }
   }'::jsonb || installment_settings
 WHERE installment_settings IS NOT NULL;

-- ── 2) Comms Studio automations ──────────────────────────────
WITH studio_defaults (
  event_key, display_name, description, category, trigger_type, cadence_config,
  subject_template, preheader_template, email_blocks_json,
  whatsapp_body_template, variables_schema
) AS (VALUES

  ('payment_received', 'Part-Payment Receipt',
   'Sent automatically after every instalment payment: how much was received, the running total, the balance, and the customer''s permanent payment link.',
   'operational', 'event',
   '{"type":"event","event":"order.payment_recorded"}'::jsonb,
   'Payment received — {{amount}} on {{order_number}}',
   'Thank you! Here is where your order stands.',
   '[
     {"type":"eyebrow","text":"PAYMENT RECEIVED"},
     {"type":"heading","text":"Thank you, {{first_name}}!"},
     {"type":"paragraph","html":"We received <strong>{{amount}}</strong> on order <strong>{{order_number}}</strong>."},
     {"type":"paragraph","html":"Paid so far: <strong>{{paid_total}}</strong><br/>Balance remaining: <strong>{{balance}}</strong>"},
     {"type":"button","label":"Pay any amount, anytime","href":"{{pay_url}}"},
     {"type":"paragraph","html":"Your order ships the moment it is fully paid.","muted":true}
   ]'::jsonb,
   'Thank you {{first_name}}! We received {{amount}} on order {{order_number}}. Paid so far: {{paid_total}} · Balance: {{balance}}. Pay anytime: {{pay_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"PXG-SO-0102"},{"name":"amount","example":"₦75,000.00"},{"name":"paid_total","example":"₦150,000.00"},{"name":"balance","example":"₦75,000.00"},{"name":"pay_url","example":"https://…/pay/abc123"},{"name":"plan_name","example":"Flexi Pay"}]'::jsonb),

  ('payment_milestone', 'Payment Milestone (Halfway)',
   'A small celebration when an instalment order crosses 50% paid. Fires once per order.',
   'lifecycle', 'event',
   '{"type":"event","event":"order.payment_milestone"}'::jsonb,
   'You''re halfway there, {{first_name}}! 🎉',
   'Your {{order_number}} is more than half paid.',
   '[
     {"type":"eyebrow","text":"MILESTONE"},
     {"type":"heading","text":"Halfway there, {{first_name}}! 🎉"},
     {"type":"paragraph","html":"Order <strong>{{order_number}}</strong> is now more than half paid. Balance remaining: <strong>{{balance}}</strong>."},
     {"type":"button","label":"Keep going","href":"{{pay_url}}"}
   ]'::jsonb,
   '🎉 Halfway there, {{first_name}}! Order {{order_number}} is over 50% paid. Balance: {{balance}}. Keep going: {{pay_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"PXG-SO-0102"},{"name":"balance","example":"₦75,000.00"},{"name":"pay_url","example":"https://…/pay/abc123"}]'::jsonb),

  ('abandoned_checkout', 'Abandoned Checkout Nudge',
   'One-time nudge for an order that was placed but never received any payment. Distinct from Abandoned Cart (which fires before an order exists). If the order stays unpaid it is auto-cancelled after the configured window.',
   'lifecycle', 'event',
   '{"type":"event","event":"order.checkout_abandoned","after_minutes":120}'::jsonb,
   'Complete your {{brand_name}} order',
   'Your order is saved — finish whenever you''re ready.',
   '[
     {"type":"eyebrow","text":"YOUR ORDER IS SAVED"},
     {"type":"heading","text":"Still thinking, {{first_name}}?"},
     {"type":"paragraph","html":"Your order <strong>{{order_number}}</strong> ({{total}}) is saved. Complete your payment whenever you''re ready."},
     {"type":"button","label":"Complete my order","href":"{{pay_url}}"}
   ]'::jsonb,
   'Hi {{first_name}}! Your {{brand_name}} order {{order_number}} ({{total}}) is saved. Complete your payment here: {{pay_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"PXG-SO-0102"},{"name":"total","example":"₦225,000.00"},{"name":"pay_url","example":"https://…/pay/abc123"},{"name":"brand_name","example":"Pixie Girl Global"}]'::jsonb)
)
INSERT INTO shared.outbound_channel_policy
  (business, event_key, channel_preference, fallback_channel, rationale,
   block_whatsapp, is_active,
   display_name, description, category, trigger_type, cadence_config,
   subject_template, preheader_template, email_blocks_json,
   whatsapp_body_template, variables_schema)
SELECT bc.business_key, s.event_key,
       'email'  AS channel_preference,
       'email'  AS fallback_channel,
       'Managed via Communications Studio.' AS rationale,
       false    AS block_whatsapp,
       true     AS is_active,
       s.display_name, s.description, s.category, s.trigger_type, s.cadence_config,
       s.subject_template, s.preheader_template, s.email_blocks_json,
       s.whatsapp_body_template, s.variables_schema
  FROM shared.business_config bc
  CROSS JOIN studio_defaults s
 WHERE bc.is_active = true
ON CONFLICT (business, event_key) DO NOTHING;
