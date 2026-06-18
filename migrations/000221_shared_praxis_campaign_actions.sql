-- ============================================================
-- MIGRATION 000221 — Praxis action catalogue entries for the
-- Sales Campaign builder.
-- Pixie Girl Hub · JBS Praxis · V2.2 — Sales Campaigns module PR 1
-- ============================================================
--
-- These rows wire the campaign-builder "Build with Praxis" assistant
-- into the existing ai_action_catalogue (migration 000012). The Praxis
-- orchestrator only invokes actions present in this table with
-- ai_enabled = true, and inherits the caller's permissions.
--
-- All write actions require human confirmation (default true): Praxis
-- materialises an ai_pending_actions row that the CEO/Marketing user
-- must accept before any state changes. Pricing/discount writes never
-- finalise a number that violates pricing_floors.min_price.
-- ============================================================

INSERT INTO shared.ai_action_catalogue (
  action_key, title, method, route, description, module, category,
  is_write, entity_scope, required_permission, ai_enabled,
  min_confidence, requires_confirmation, examples
) VALUES
  ('sales_campaigns.draft_copy',
   'Draft hero / block copy from a brief',
   'POST', '/api/v1/sales-campaigns/:id/praxis/draft-copy',
   'Generate hero title, hero subtitle, product blurbs, FAQ entries, '
   'email and WhatsApp blast text from a natural-language brief. '
   'Honours the brand voice profile in business_config.praxis_voice_profile '
   'and refuses fabricated reviews or banned superlatives.',
   'sales_campaigns', 'draft', false, 'both',
   'sales_campaigns.edit', true, 0.80, true,
   '[
     {"utterance": "Draft a Black Friday hero for the Pixie collection",
      "payload":   {"section": "hero", "campaign_theme": "Black Friday", "tone_override": null}},
     {"utterance": "Write FAQ entries about delivery and returns",
      "payload":   {"section": "faq", "topics": ["delivery", "returns", "sizing"]}}
   ]'::jsonb),

  ('sales_campaigns.suggest_layout',
   'Suggest block layout + section order',
   'POST', '/api/v1/sales-campaigns/:id/praxis/suggest-layout',
   'Propose which landing-page blocks to enable, their order, and a '
   'short rationale per block. Returns a draft layout the CEO can '
   'accept or edit in the landing editor. Never auto-applied.',
   'sales_campaigns', 'draft', false, 'both',
   'sales_campaigns.edit', true, 0.75, true,
   '[
     {"utterance": "Suggest a layout for a 48-hour flash sale on frontals",
      "payload":   {"campaign_type": "flash_sale", "duration_hours": 48, "product_focus": "frontals"}}
   ]'::jsonb),

  ('sales_campaigns.suggest_discount_math',
   'Suggest discount maths (bundle + tier ladder)',
   'POST', '/api/v1/sales-campaigns/:id/praxis/suggest-pricing',
   'Read the cost vault and pricing floor, then propose safe ₦ '
   'discounts per bundle, the quantity-tier ladder, and the escalating '
   'cart upsell offers. Refuses prices that breach pricing_floors.min_price. '
   'Returns the full breakdown so the CEO can see the maths.',
   'sales_campaigns', 'draft', false, 'both',
   'sales_campaigns.edit', true, 0.85, true,
   '[
     {"utterance": "Suggest bundle discounts targeting 25% net margin",
      "payload":   {"target_margin_pct": 0.25, "include_charm_rounding": true}}
   ]'::jsonb),

  ('sales_campaigns.dry_run_pricing',
   'Dry-run pricing question (read-only)',
   'POST', '/api/v1/sales-campaigns/:id/praxis/dry-run-pricing',
   'Answer plain-English pricing questions ("Will ₦149,000 break the '
   'floor?", "What''s my margin if I price the 5-bundle at ₦400k?") by '
   'calling the pricing engine read-only. Never writes anything.',
   'sales_campaigns', 'read', false, 'both',
   'sales_campaigns.view', true, 0.70, false,
   '[
     {"utterance": "Is ₦149,000 above the floor on the HD Lace Front?",
      "payload":   {"product_id": null, "proposed_price_ngn": 149000}}
   ]'::jsonb),

  ('sales_campaigns.analytics_qna',
   'Plain-English campaign analytics Q&A',
   'POST', '/api/v1/sales-campaigns/:id/praxis/analytics-qna',
   'Answer natural-language questions about a running or ended campaign '
   '("Which bundle sold most yesterday?", "Why did conversion drop after 3pm?"). '
   'Returns answer text + supporting numbers + optional causal hypotheses '
   'with explicit uncertainty disclaimers.',
   'sales_campaigns', 'read', false, 'both',
   'sales_campaigns.view', true, 0.70, false,
   '[
     {"utterance": "Why did add-to-cart fall after 3pm yesterday?",
      "payload":   {"question": "Why did add-to-cart fall after 3pm yesterday?"}}
   ]'::jsonb),

  ('sales_campaigns.daily_briefing',
   'Generate the daily AI briefing for a live campaign',
   'GET',  '/api/v1/sales-campaigns/:id/praxis/daily-briefing',
   'Compose the morning briefing (yesterday''s numbers, top 3 movers, one '
   'recommended action). Used by the scheduler that emails the CEO at 8am '
   'during a live campaign. Read-only.',
   'sales_campaigns', 'read', false, 'both',
   'sales_campaigns.view', true, 0.85, false,
   '[]'::jsonb)
ON CONFLICT (action_key) DO UPDATE SET
  title               = EXCLUDED.title,
  description         = EXCLUDED.description,
  method              = EXCLUDED.method,
  route               = EXCLUDED.route,
  required_permission = EXCLUDED.required_permission,
  is_write            = EXCLUDED.is_write,
  ai_enabled          = EXCLUDED.ai_enabled,
  examples            = EXCLUDED.examples,
  updated_at          = now();

-- Verify:
--   SELECT action_key, ai_enabled, category, is_write
--     FROM shared.ai_action_catalogue
--    WHERE module = 'sales_campaigns'
--    ORDER BY action_key;
