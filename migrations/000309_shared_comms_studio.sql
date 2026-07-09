-- ============================================================
-- 000309_shared_comms_studio
--
-- Communications Studio — one CEO-editable table for every automated
-- outbound message the Hub sends. Replaces the six ad-hoc send sites
-- that hardcoded strings and bypassed the outbound_channel_policy
-- matrix (invoice-delivery, receipt-delivery, campaigns.notifications,
-- retention/workflow, layaway-reminders, invoice-reminders).
--
-- What this migration does:
--
--   1. Extends shared.outbound_channel_policy with the studio's
--      editable columns — display_name, description, category,
--      trigger_type, cadence_config, subject/body templates per
--      channel, variables schema.
--
--   2. Creates shared.automation_send_log — idempotency ledger so
--      a re-run of the same send (e.g. same birthday, same day) is
--      a no-op. Every dispatch stamps a row here first.
--
--   3. Backfills studio metadata for the 15 automations already
--      seeded by 000214 AND inserts the new birthday_wish automation.
--      Everything defaults to email as the channel — the CEO opts
--      into WhatsApp per automation from the Studio UI. Direct-send
--      sites lose that choice (they get it from THIS table).
--
-- Idempotent: ALTER … ADD COLUMN IF NOT EXISTS, INSERT … ON CONFLICT
-- DO UPDATE only on the studio-metadata columns. Never touches an
-- operator's saved template body if it already differs from the
-- shipped default.
-- ============================================================

BEGIN;

-- ── 1) Extend outbound_channel_policy ──────────────────────

ALTER TABLE shared.outbound_channel_policy
  ADD COLUMN IF NOT EXISTS display_name             TEXT,
  ADD COLUMN IF NOT EXISTS description              TEXT,
  ADD COLUMN IF NOT EXISTS category                 TEXT
    CHECK (category IS NULL OR category IN
           ('transactional','lifecycle','marketing','operational')),
  -- 'event'      — fires when the domain event happens (invoice sent, receipt paid)
  -- 'scheduled'  — cron sweep at a fixed cadence (layaway reminder every 30 min)
  -- 'annual'     — once a year on a contact-relative date (birthday)
  ADD COLUMN IF NOT EXISTS trigger_type             TEXT
    CHECK (trigger_type IS NULL OR trigger_type IN
           ('event','scheduled','annual','recurring')),
  -- Free-form JSONB for schedule specifics:
  --   {"type":"scheduled","every_min":30}
  --   {"type":"scheduled","every_days":7,"hour_local":10}
  --   {"type":"annual","source":"contact.date_of_birth","hour_local":9}
  --   {"type":"event","event":"invoice.due_date","offset_days":[3,7,14]}
  ADD COLUMN IF NOT EXISTS cadence_config           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Templates. NULL means "use whatever the caller already passes in"
  -- (backwards-compat for the ad-hoc sites during the refactor window).
  ADD COLUMN IF NOT EXISTS subject_template         TEXT,
  ADD COLUMN IF NOT EXISTS preheader_template       TEXT,
  -- The block editor's output. Array of block objects the compiler
  -- turns into brand-skinned HTML at send time. Shape:
  --   [{"type":"eyebrow","text":"YOUR ORDER"},
  --    {"type":"heading","text":"Order {{order_number}} is on its way"},
  --    {"type":"paragraph","html":"Hi {{first_name}}, …"},
  --    {"type":"button","label":"Track it","href":"{{tracking_url}}"},
  --    {"type":"divider"}]
  ADD COLUMN IF NOT EXISTS email_blocks_json        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_body_template   TEXT,
  ADD COLUMN IF NOT EXISTS instagram_body_template  TEXT,
  -- What variables the operator can drop in {{tokens}} for this event.
  -- The Studio UI reads this to render the variable palette and to
  -- warn when a saved template references an unknown token.
  --   [{"name":"first_name","example":"Adaeze","required":false}, …]
  ADD COLUMN IF NOT EXISTS variables_schema         JSONB       NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN shared.outbound_channel_policy.email_blocks_json IS
  'Block-editor output. Compiled to HTML by comms_studio.compile at send time.';
COMMENT ON COLUMN shared.outbound_channel_policy.cadence_config IS
  'JSONB schedule spec — see comms_studio/README.md for the type discriminator.';

-- ── 2) automation_send_log — idempotency ledger ────────────

CREATE TABLE IF NOT EXISTS shared.automation_send_log (
  send_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  event_key     TEXT        NOT NULL,
  contact_id    UUID        REFERENCES shared.contacts (contact_id) ON DELETE SET NULL,
  -- Every automation picks its own dedup shape and stamps a string that
  -- captures "the send I already made". Birthday uses the year
  -- (2026-birthday-{contact_id}). Invoice reminder uses the reminder_id.
  -- Layaway uses order_id+cadence_bucket.
  dedup_key     TEXT        NOT NULL,
  channel       TEXT        NOT NULL
    CHECK (channel IN ('email','whatsapp','instagram','in_app_only','disabled')),
  variables     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT        NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','failed','skipped')),
  failure_reason TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, event_key, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_automation_send_log_contact
  ON shared.automation_send_log (contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_send_log_business_event
  ON shared.automation_send_log (business, event_key, sent_at DESC);

-- ── 3) Seed studio metadata for every automation ──────────
--
-- We UPSERT display metadata, category, trigger_type, cadence_config,
-- variables_schema, and defaults for templates so a fresh install has
-- something readable in the Studio without an operator typing anything.
-- Existing rows keep their operator-chosen channel_preference and
-- block_whatsapp — this migration is metadata only for those columns,
-- and the studio-only columns get set from these defaults.
--
-- Everything defaults to email as the channel. That is deliberate per
-- the cost-discipline conversation: nothing goes over WhatsApp until
-- the CEO opens the Studio and picks WhatsApp for that specific event.
-- Old whatsapp defaults from 000214 (payment_reminder, layaway_reminder,
-- out_for_delivery, delivery_failed, stylist_assignment) are FORCED to
-- email here so the audit and the Studio agree on today's shape.

WITH studio_defaults(event_key, display_name, description, category, trigger_type,
                     cadence_config, subject_template, preheader_template,
                     email_blocks_json, whatsapp_body_template, variables_schema) AS (VALUES

  -- ─ Transactional (customer sees these tied to an action she took) ─

  ('order_confirmation', 'Order Confirmation',
   'Sent right after a sales order is placed. Confirms what she ordered and the total.',
   'transactional', 'event',
   '{"type":"event","event":"order.placed"}'::jsonb,
   'Order {{order_number}} received — thank you, {{first_name}}',
   'Your order at {{brand_name}} is confirmed.',
   '[
     {"type":"eyebrow","text":"YOUR ORDER"},
     {"type":"heading","text":"Order {{order_number}} received"},
     {"type":"paragraph","html":"Hi {{first_name}}, thank you for your order. We''ve received it and will confirm shipment shortly."},
     {"type":"paragraph","html":"Order total: <strong>{{total_ngn_display}}</strong>."},
     {"type":"button","label":"View your order","href":"{{tracking_url}}"},
     {"type":"divider"}
   ]'::jsonb,
   'Hi {{first_name}}! Order {{order_number}} received — total {{total_ngn_display}}. Track: {{tracking_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"PXG-SO-1024"},{"name":"total_ngn_display","example":"₦200,000.00"},{"name":"tracking_url","example":"https://…"}]'::jsonb),

  ('order_paid_receipt', 'Payment Received (Receipt)',
   'Sent when a payment on an order clears. The proof-of-payment receipt.',
   'transactional', 'event',
   '{"type":"event","event":"receipt.issued"}'::jsonb,
   'Receipt {{receipt_number}} — {{amount_ngn_display}} received',
   'Your payment at {{brand_name}} is in.',
   '[
     {"type":"eyebrow","text":"PAYMENT RECEIVED"},
     {"type":"heading","text":"Receipt {{receipt_number}}"},
     {"type":"paragraph","html":"Hi {{first_name}}, we''ve received your payment of <strong>{{amount_ngn_display}}</strong>{{invoice_reference_html}}."},
     {"type":"button","label":"View your receipt","href":"{{view_url}}"},
     {"type":"divider"}
   ]'::jsonb,
   '{{brand_name}}: Receipt {{receipt_number}} — {{amount_ngn_display}} received. View: {{view_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"receipt_number","example":"PXG-RC-0101"},{"name":"amount_ngn_display","example":"₦80,000.00"},{"name":"invoice_reference_html","example":" for invoice PXG-INV-0303"},{"name":"view_url","example":"https://…"}]'::jsonb),

  ('invoice_issued', 'Invoice Issued',
   'Sent when an invoice is created and marked sent.',
   'transactional', 'event',
   '{"type":"event","event":"invoice.sent"}'::jsonb,
   'Invoice {{invoice_number}} — {{balance_due_ngn_display}} due',
   'Your invoice from {{brand_name}}.',
   '[
     {"type":"eyebrow","text":"YOUR INVOICE"},
     {"type":"heading","text":"Invoice {{invoice_number}}"},
     {"type":"paragraph","html":"Hi {{first_name}}, please find invoice <strong>{{invoice_number}}</strong> for <strong>{{balance_due_ngn_display}}</strong>{{due_date_html}}."},
     {"type":"button","label":"View your invoice","href":"{{view_url}}"},
     {"type":"divider"}
   ]'::jsonb,
   '{{brand_name}}: Invoice {{invoice_number}} — {{balance_due_ngn_display}} due{{due_date_text}}. View: {{view_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"invoice_number","example":"PXG-INV-0303"},{"name":"balance_due_ngn_display","example":"₦120,000.00"},{"name":"due_date_html","example":" by <strong>15 July 2026</strong>"},{"name":"due_date_text","example":" by 15 July 2026"},{"name":"view_url","example":"https://…"}]'::jsonb),

  ('order_ready', 'Order Ready',
   'Sent when an order is packaged and ready for handover to the courier.',
   'transactional', 'event',
   '{"type":"event","event":"order.ready"}'::jsonb,
   'Order {{order_number}} is packed and ready',
   'Almost there — final step is dispatch.',
   '[
     {"type":"eyebrow","text":"ORDER READY"},
     {"type":"heading","text":"Order {{order_number}} is packed"},
     {"type":"paragraph","html":"Hi {{first_name}}, your order is packaged and waiting for the courier. We''ll message you again when it ships."},
     {"type":"button","label":"Track your order","href":"{{tracking_url}}"}
   ]'::jsonb,
   '{{brand_name}}: Order {{order_number}} is packed and ready. Track: {{tracking_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"PXG-SO-1024"},{"name":"tracking_url","example":"https://…"}]'::jsonb),

  ('order_shipped', 'Order Shipped',
   'Sent when the order is handed to the courier.',
   'transactional', 'event',
   '{"type":"event","event":"order.shipped"}'::jsonb,
   'Order {{order_number}} is on its way',
   'Track your delivery.',
   '[
     {"type":"eyebrow","text":"ON ITS WAY"},
     {"type":"heading","text":"Order {{order_number}} shipped"},
     {"type":"paragraph","html":"Hi {{first_name}}, your order is with the courier. Live tracking below."},
     {"type":"button","label":"Track your delivery","href":"{{tracking_url}}"}
   ]'::jsonb,
   '{{brand_name}}: Order {{order_number}} shipped. Track: {{tracking_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"PXG-SO-1024"},{"name":"tracking_url","example":"https://…"}]'::jsonb),

  ('out_for_delivery', 'Out for Delivery',
   'Sent when the courier marks the order out for delivery.',
   'transactional', 'event',
   '{"type":"event","event":"order.out_for_delivery"}'::jsonb,
   'Your order is out for delivery',
   'Coming today.',
   '[
     {"type":"eyebrow","text":"OUT FOR DELIVERY"},
     {"type":"heading","text":"Coming today"},
     {"type":"paragraph","html":"Hi {{first_name}}, your order is with the rider now. Please keep your phone nearby."},
     {"type":"button","label":"Track your rider","href":"{{tracking_url}}"}
   ]'::jsonb,
   '{{brand_name}}: Your order is out for delivery. Rider may call. Track: {{tracking_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"tracking_url","example":"https://…"}]'::jsonb),

  ('delivery_failed', 'Delivery Failed',
   'Sent when a delivery attempt failed and the customer needs to act to reschedule.',
   'transactional', 'event',
   '{"type":"event","event":"order.delivery_failed"}'::jsonb,
   'We couldn''t deliver — let''s reschedule',
   'A small hiccup on delivery.',
   '[
     {"type":"eyebrow","text":"DELIVERY ATTEMPT"},
     {"type":"heading","text":"We missed you"},
     {"type":"paragraph","html":"Hi {{first_name}}, the rider couldn''t complete delivery today. Tap below to pick a new time."},
     {"type":"button","label":"Reschedule delivery","href":"{{tracking_url}}"}
   ]'::jsonb,
   '{{brand_name}}: Delivery failed. Reschedule: {{tracking_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"tracking_url","example":"https://…"}]'::jsonb),

  ('payment_reminder', 'Payment Reminder',
   'Sent to nudge unpaid invoices as they approach or pass their due date.',
   'transactional', 'scheduled',
   '{"type":"scheduled","every_min":30,"quiet_hours_local":[22,7]}'::jsonb,
   'Reminder: invoice {{invoice_number}} — {{balance_due_ngn_display}} due',
   'A gentle nudge on your invoice.',
   '[
     {"type":"eyebrow","text":"REMINDER"},
     {"type":"heading","text":"Invoice {{invoice_number}}"},
     {"type":"paragraph","html":"Hi {{first_name}}, a quick reminder that <strong>{{balance_due_ngn_display}}</strong> is due on invoice <strong>{{invoice_number}}</strong>{{due_date_html}}."},
     {"type":"button","label":"Pay now","href":"{{pay_url}}"}
   ]'::jsonb,
   'Hi {{first_name}}! Reminder — {{balance_due_ngn_display}} due on invoice {{invoice_number}}{{due_date_text}}. Pay: {{pay_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"invoice_number","example":"PXG-INV-0303"},{"name":"balance_due_ngn_display","example":"₦120,000.00"},{"name":"due_date_html","example":" by <strong>15 July 2026</strong>"},{"name":"due_date_text","example":" by 15 July 2026"},{"name":"pay_url","example":"https://…"}]'::jsonb),

  ('layaway_reminder', 'Layaway Reminder',
   'Sent on a cadence to nudge customers on outstanding layaway balances. Only fires for orders with at least one payment on file — brand-new untouched orders are excluded.',
   'transactional', 'scheduled',
   '{"type":"scheduled","every_min":30,"min_amount_paid_ngn":1,"quiet_hours_local":[22,7]}'::jsonb,
   'Your layaway on order {{order_number}} — {{balance_due_ngn_display}} left',
   'Pay any amount, anytime.',
   '[
     {"type":"eyebrow","text":"LAYAWAY"},
     {"type":"heading","text":"Order {{order_number}}"},
     {"type":"paragraph","html":"Hi {{first_name}}, you''ve paid <strong>{{amount_paid_ngn_display}}</strong> of <strong>{{total_ngn_display}}</strong> on order <strong>{{order_number}}</strong>. Balance: <strong>{{balance_due_ngn_display}}</strong>."},
     {"type":"paragraph","html":"Pay any amount, anytime — your wig ships when it''s paid in full."},
     {"type":"button","label":"Pay towards your order","href":"{{pay_url}}"}
   ]'::jsonb,
   'Hi {{first_name}}! You''ve paid {{amount_paid_ngn_display}} of {{total_ngn_display}} on order {{order_number}} ({{balance_due_ngn_display}} left). Pay any amount: {{pay_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"FLH-SO-0080"},{"name":"amount_paid_ngn_display","example":"₦80,000.00"},{"name":"total_ngn_display","example":"₦200,000.00"},{"name":"balance_due_ngn_display","example":"₦120,000.00"},{"name":"pay_url","example":"https://…"}]'::jsonb),

  ('production_update', 'Production Update',
   'Optional in-app progress ping for made-to-order items.',
   'transactional', 'event',
   '{"type":"event","event":"order.production_update"}'::jsonb,
   'A quick production update on your order {{order_number}}',
   'Progress on your order.',
   '[
     {"type":"eyebrow","text":"PRODUCTION"},
     {"type":"heading","text":"Order {{order_number}} update"},
     {"type":"paragraph","html":"Hi {{first_name}}, {{stage_message}}"}
   ]'::jsonb,
   '{{brand_name}}: {{stage_message}} — order {{order_number}}.',
   '[{"name":"first_name","example":"Adaeze"},{"name":"order_number","example":"PXG-SO-1024"},{"name":"stage_message","example":"we''ve begun weaving your custom unit."}]'::jsonb),

  -- ─ Lifecycle (relationship over time) ─

  ('welcome', 'Welcome',
   'First message a new customer gets after signup or first purchase.',
   'lifecycle', 'event',
   '{"type":"event","event":"contact.welcome"}'::jsonb,
   'Welcome to {{brand_name}}, {{first_name}}',
   'A warm hello from the team.',
   '[
     {"type":"eyebrow","text":"WELCOME"},
     {"type":"heading","text":"So glad you''re here, {{first_name}}"},
     {"type":"paragraph","html":"Welcome to the {{brand_name}} community. We craft with intention — every piece we ship is made to make you feel like the version of yourself you want to be seen as."},
     {"type":"button","label":"Explore the collection","href":"{{website_url}}"}
   ]'::jsonb,
   'Welcome to {{brand_name}}, {{first_name}}! Explore: {{website_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"website_url","example":"https://…"}]'::jsonb),

  ('birthday_wish', 'Birthday Wish',
   'Sent on a contact''s birthday. A warm greeting, optionally with a small treat. Only fires once per contact per year (idempotent via automation_send_log).',
   'lifecycle', 'annual',
   '{"type":"annual","source":"contact.date_of_birth","hour_local":9}'::jsonb,
   'Happy birthday, {{first_name}} 🎂',
   'A little something from all of us at {{brand_name}}.',
   '[
     {"type":"eyebrow","text":"HAPPY BIRTHDAY"},
     {"type":"heading","text":"Happy birthday, {{first_name}} 🎂"},
     {"type":"paragraph","html":"From everyone at {{brand_name}} — wishing you a beautiful year ahead. Thank you for being part of our story."},
     {"type":"paragraph","html":"With love,<br/>The {{brand_name}} team","muted":true}
   ]'::jsonb,
   'Happy birthday, {{first_name}}! 🎂 Wishing you a beautiful year ahead — with love from all of us at {{brand_name}}.',
   '[{"name":"first_name","example":"Adaeze"},{"name":"brand_name","example":"Pixie Girl Global"}]'::jsonb),

  ('abandoned_cart', 'Abandoned Cart',
   'Sent to registered customers whose cart went idle before checkout.',
   'lifecycle', 'event',
   '{"type":"event","event":"cart.abandoned","after_minutes":90}'::jsonb,
   'Still thinking, {{first_name}}? Your cart is saved',
   'Come finish what you started.',
   '[
     {"type":"eyebrow","text":"YOUR CART"},
     {"type":"heading","text":"Still thinking, {{first_name}}?"},
     {"type":"paragraph","html":"Your cart is safe with us. Pick up where you left off whenever you''re ready."},
     {"type":"button","label":"Continue to checkout","href":"{{cart_url}}"}
   ]'::jsonb,
   'Your {{brand_name}} cart is saved: {{cart_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"cart_url","example":"https://…"}]'::jsonb),

  ('review_request', 'Review Request',
   'Sent a few days after delivery to ask the customer to leave a review.',
   'lifecycle', 'event',
   '{"type":"event","event":"order.delivered","offset_days":3}'::jsonb,
   'How was your order, {{first_name}}?',
   'A minute of your time — thank you.',
   '[
     {"type":"eyebrow","text":"A QUICK ASK"},
     {"type":"heading","text":"How did we do, {{first_name}}?"},
     {"type":"paragraph","html":"We''d love to hear how you''re feeling about your order. It takes a minute and helps other women decide."},
     {"type":"button","label":"Leave a review","href":"{{review_url}}"}
   ]'::jsonb,
   'Loved your order? Tell us: {{review_url}}',
   '[{"name":"first_name","example":"Adaeze"},{"name":"review_url","example":"https://…"}]'::jsonb),

  -- ─ Marketing (broadcast — hard-blocked from WhatsApp) ─

  ('marketing_blast', 'Marketing Blast',
   'Broadcast marketing send to a segment. WhatsApp is hard-blocked for this event by policy — even if a contact prefers WhatsApp we will not send marketing there.',
   'marketing', 'event',
   '{"type":"event","event":"marketing.send"}'::jsonb,
   '{{campaign_subject}}',
   '{{campaign_preheader}}',
   '[
     {"type":"eyebrow","text":"{{campaign_eyebrow}}"},
     {"type":"heading","text":"{{campaign_headline}}"},
     {"type":"paragraph","html":"{{campaign_body_html}}"},
     {"type":"button","label":"{{cta_label}}","href":"{{cta_url}}"}
   ]'::jsonb,
   NULL,
   '[{"name":"campaign_subject","example":"July drop is here"},{"name":"campaign_preheader","example":"Ten new pieces."},{"name":"campaign_eyebrow","example":"JULY DROP"},{"name":"campaign_headline","example":"Ten new pieces"},{"name":"campaign_body_html","example":"<p>Our July collection is live…</p>"},{"name":"cta_label","example":"Shop the drop"},{"name":"cta_url","example":"https://…"}]'::jsonb),

  ('campaign_launch', 'Campaign Launch',
   'Sent to signups on a sales campaign''s pre-launch list when the campaign flips live. WhatsApp is hard-blocked here.',
   'marketing', 'event',
   '{"type":"event","event":"campaign.go_live"}'::jsonb,
   '{{campaign_name}} is live',
   'Shop before it ends.',
   '[
     {"type":"eyebrow","text":"NOW LIVE"},
     {"type":"heading","text":"{{campaign_name}} is live"},
     {"type":"paragraph","html":"Hi {{first_name}}, the sale you signed up for is now open. Prices are what they are for the length of the campaign — don''t leave it to the last day."},
     {"type":"button","label":"Shop the sale","href":"{{campaign_url}}"}
   ]'::jsonb,
   NULL,
   '[{"name":"first_name","example":"Adaeze"},{"name":"campaign_name","example":"July Drop"},{"name":"campaign_url","example":"https://…"}]'::jsonb),

  ('newsletter', 'Newsletter',
   'Regular editorial send to subscribers.',
   'marketing', 'event',
   '{"type":"event","event":"newsletter.send"}'::jsonb,
   '{{newsletter_subject}}',
   '{{newsletter_preheader}}',
   '[
     {"type":"eyebrow","text":"NEWSLETTER"},
     {"type":"heading","text":"{{newsletter_headline}}"},
     {"type":"paragraph","html":"{{newsletter_body_html}}"}
   ]'::jsonb,
   NULL,
   '[{"name":"newsletter_subject","example":"This week"},{"name":"newsletter_preheader","example":"Editorial + drops."},{"name":"newsletter_headline","example":"This week at {{brand_name}}"},{"name":"newsletter_body_html","example":"<p>…</p>"}]'::jsonb),

  -- ─ Operational (internal / staff-facing) ─

  ('staff_invite', 'Staff Invite',
   'Sent when the CEO/HR invites a new staff member to join the Hub.',
   'operational', 'event',
   '{"type":"event","event":"staff.invited"}'::jsonb,
   'You''ve been invited to {{brand_name}}',
   'Set your password to join.',
   '[
     {"type":"eyebrow","text":"INVITATION"},
     {"type":"heading","text":"Welcome to {{brand_name}}"},
     {"type":"paragraph","html":"Hi {{first_name}}, {{inviter_name}} invited you to join the {{brand_name}} team. Tap below to set your password and sign in."},
     {"type":"button","label":"Accept the invitation","href":"{{invite_url}}"}
   ]'::jsonb,
   NULL,
   '[{"name":"first_name","example":"Ada"},{"name":"inviter_name","example":"Faith"},{"name":"invite_url","example":"https://…"}]'::jsonb),

  ('stylist_assignment', 'Stylist Assignment',
   'Sent to a stylist when a service job is assigned to them.',
   'operational', 'event',
   '{"type":"event","event":"service_job.assigned"}'::jsonb,
   'New job assigned: {{job_number}}',
   'Details inside.',
   '[
     {"type":"eyebrow","text":"NEW JOB"},
     {"type":"heading","text":"Job {{job_number}} is yours"},
     {"type":"paragraph","html":"Hi {{first_name}}, {{job_summary}}"},
     {"type":"button","label":"Open the job","href":"{{job_url}}"}
   ]'::jsonb,
   'New job {{job_number}}: {{job_summary}} — {{job_url}}',
   '[{"name":"first_name","example":"Chidi"},{"name":"job_number","example":"PXG-SJ-0055"},{"name":"job_summary","example":"Install for Adaeze at 3pm today."},{"name":"job_url","example":"https://…"}]'::jsonb)
)
INSERT INTO shared.outbound_channel_policy
  (business, event_key, channel_preference, fallback_channel, rationale,
   block_whatsapp, is_active,
   display_name, description, category, trigger_type, cadence_config,
   subject_template, preheader_template, email_blocks_json,
   whatsapp_body_template, variables_schema)
SELECT bc.business_key, s.event_key,
       'email'                                   AS channel_preference,
       CASE WHEN s.event_key IN ('marketing_blast','campaign_launch','newsletter') THEN NULL
            ELSE 'email' END                     AS fallback_channel,
       'Managed via Communications Studio.'      AS rationale,
       -- Marketing broadcasts stay hard-blocked from WhatsApp regardless
       -- of contact preference, matching the cost policy.
       (s.event_key IN ('marketing_blast','campaign_launch','newsletter')) AS block_whatsapp,
       true                                      AS is_active,
       s.display_name, s.description, s.category, s.trigger_type, s.cadence_config,
       s.subject_template, s.preheader_template, s.email_blocks_json,
       s.whatsapp_body_template, s.variables_schema
  FROM shared.business_config bc
  CROSS JOIN studio_defaults s
  WHERE bc.is_active = true
ON CONFLICT (business, event_key) DO UPDATE SET
  -- Never overwrite operator choices on channel_preference /
  -- fallback_channel / block_whatsapp — those are the CEO's call.
  -- But DO refresh the studio metadata + template DEFAULTS iff the
  -- row still carries the empty seed (i.e. was created before this
  -- migration ran). We detect that with a NULL display_name.
  display_name           = COALESCE(shared.outbound_channel_policy.display_name,          EXCLUDED.display_name),
  description            = COALESCE(shared.outbound_channel_policy.description,           EXCLUDED.description),
  category               = COALESCE(shared.outbound_channel_policy.category,              EXCLUDED.category),
  trigger_type           = COALESCE(shared.outbound_channel_policy.trigger_type,          EXCLUDED.trigger_type),
  cadence_config         = CASE WHEN shared.outbound_channel_policy.cadence_config = '{}'::jsonb
                                 THEN EXCLUDED.cadence_config
                                 ELSE shared.outbound_channel_policy.cadence_config END,
  subject_template       = COALESCE(shared.outbound_channel_policy.subject_template,      EXCLUDED.subject_template),
  preheader_template     = COALESCE(shared.outbound_channel_policy.preheader_template,    EXCLUDED.preheader_template),
  email_blocks_json      = CASE WHEN shared.outbound_channel_policy.email_blocks_json = '[]'::jsonb
                                 THEN EXCLUDED.email_blocks_json
                                 ELSE shared.outbound_channel_policy.email_blocks_json END,
  whatsapp_body_template = COALESCE(shared.outbound_channel_policy.whatsapp_body_template, EXCLUDED.whatsapp_body_template),
  variables_schema       = CASE WHEN shared.outbound_channel_policy.variables_schema = '[]'::jsonb
                                 THEN EXCLUDED.variables_schema
                                 ELSE shared.outbound_channel_policy.variables_schema END,
  updated_at             = now();

-- ── 4) Force default channel to email for the old whatsapp-default rows ─
--
-- The 000214 seed set payment_reminder / layaway_reminder / out_for_delivery /
-- delivery_failed / stylist_assignment default = whatsapp. The user has
-- explicitly asked to reset every automation to email until the CEO opts
-- back in via the Studio. Only touches rows still on the shipped default
-- (rationale = '…recovery rates…' etc. from 000214) so we don't clobber
-- an operator who already picked something bespoke.
UPDATE shared.outbound_channel_policy p
   SET channel_preference = 'email',
       rationale = 'Reset to email by Communications Studio migration; re-enable WhatsApp per event from the Studio if desired.',
       updated_at = now()
 WHERE p.event_key IN ('payment_reminder','layaway_reminder','out_for_delivery','delivery_failed','stylist_assignment')
   AND p.channel_preference = 'whatsapp'
   AND (p.rationale IS NULL OR p.rationale NOT LIKE 'Managed via Communications Studio.%');

-- ── 5) Permission grants for the comms_studio module ──────
--
-- CEO/owner is bypassed by the middleware, but seed an explicit grant so
-- audit/RBAC tools show it. Marketing/Partner gets view — they can look
-- up what an automation says without necessarily being able to edit.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'comms_studio', a.action, 'all'
  FROM (VALUES
    ('11111111-1111-1111-1111-000000000001'::uuid), -- owner
    ('22222222-2222-2222-2222-000000000005'::uuid)  -- mktg_partner
  ) AS r(role_id)
  CROSS JOIN (VALUES ('view'), ('edit')) AS a(action)
  WHERE NOT (
    r.role_id = '22222222-2222-2222-2222-000000000005'::uuid
    AND a.action = 'edit'
  )
ON CONFLICT (role_id, module, action) DO NOTHING;

COMMIT;
