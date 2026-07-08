-- ============================================================
-- MIGRATION 000307 — Payload schemas for the Praxis campaign
-- actions (fixes the "missing a required reference" loop).
-- Pixie Girl Hub · JBS Praxis · V2.2 — Praxis hallucination fixes PR 1
-- ============================================================
--
-- Migration 000221 seeded the six sales_campaigns Praxis actions with
-- routes containing `:id` but left payload_schema at its default '{}'.
-- The orchestrator normalises '{}' to an EMPTY tool-parameter schema,
-- so the model was never told a campaign id is required — every
-- proposal then failed at execution with ACTION_ROUTE_PARAMS_MISSING
-- ("This action is missing a required reference").
--
-- This migration gives each action a real JSON Schema (mirroring the
-- route's Zod validator, plus the `id` route param) and updates the
-- descriptions + examples so the model knows to look the campaign id
-- up first (query_campaigns_recent) instead of guessing.
-- ============================================================

-- Shared `id` property text (kept identical across actions on purpose:
-- consistent phrasing measurably improves tool-arg fill rates).
-- "Campaign UUID (campaign_id). REQUIRED. If unknown, call
--  query_campaigns_recent first and use its campaign_id."

UPDATE shared.ai_action_catalogue SET
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string", "description": "Campaign UUID (campaign_id). REQUIRED. If unknown, call query_campaigns_recent first and use its campaign_id."},
      "section": {"type": "string", "enum": ["hero", "faq", "blast", "product_blurbs"], "description": "Which copy section to draft."},
      "brief": {"type": "string", "description": "Natural-language brief for the copy (max 2000 chars)."},
      "campaign_theme": {"type": "string", "description": "Theme, e.g. Black Friday (max 200 chars)."},
      "product_focus": {"type": "string", "description": "Product or collection to focus on (max 200 chars)."},
      "topics": {"type": "array", "items": {"type": "string"}, "description": "FAQ topics (max 10, each max 80 chars)."},
      "tone_override": {"type": "string", "description": "Optional tone override (max 60 chars)."}
    },
    "required": ["id", "section"]
  }'::jsonb,
  description = 'Generate hero title, hero subtitle, product blurbs, FAQ entries, email and WhatsApp blast text from a natural-language brief. Honours the brand voice profile in business_config.praxis_voice_profile and refuses fabricated reviews or banned superlatives. Requires the campaign id — look it up with query_campaigns_recent if unknown.',
  examples = '[
    {"utterance": "Draft a Black Friday hero for the Pixie collection",
     "payload":   {"id": "<campaign_id from query_campaigns_recent>", "section": "hero", "campaign_theme": "Black Friday"}},
    {"utterance": "Write FAQ entries about delivery and returns",
     "payload":   {"id": "<campaign_id from query_campaigns_recent>", "section": "faq", "topics": ["delivery", "returns", "sizing"]}}
  ]'::jsonb
WHERE action_key = 'sales_campaigns.draft_copy';

UPDATE shared.ai_action_catalogue SET
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string", "description": "Campaign UUID (campaign_id). REQUIRED. If unknown, call query_campaigns_recent first and use its campaign_id."},
      "campaign_type": {"type": "string", "description": "e.g. flash_sale, seasonal, clearance (max 60 chars)."},
      "duration_hours": {"type": "integer", "minimum": 1, "maximum": 720, "description": "Planned campaign duration in hours."},
      "product_focus": {"type": "string", "description": "Product or collection to focus on (max 200 chars)."}
    },
    "required": ["id"]
  }'::jsonb,
  description = 'Propose which landing-page blocks to enable, their order, and a short rationale per block. Returns a draft layout the CEO can accept or edit in the landing editor. Never auto-applied. Requires the campaign id — look it up with query_campaigns_recent if unknown.',
  examples = '[
    {"utterance": "Suggest a layout for a 48-hour flash sale on frontals",
     "payload":   {"id": "<campaign_id from query_campaigns_recent>", "campaign_type": "flash_sale", "duration_hours": 48, "product_focus": "frontals"}}
  ]'::jsonb
WHERE action_key = 'sales_campaigns.suggest_layout';

UPDATE shared.ai_action_catalogue SET
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string", "description": "Campaign UUID (campaign_id). REQUIRED. If unknown, call query_campaigns_recent first and use its campaign_id."},
      "target_margin_pct": {"type": "number", "minimum": 0, "maximum": 0.95, "description": "Target net margin as a fraction, e.g. 0.25 for 25%."},
      "include_charm_rounding": {"type": "boolean", "description": "Apply charm rounding to suggested prices."},
      "inputs": {
        "type": "array",
        "minItems": 1,
        "maxItems": 50,
        "description": "One entry per product/bundle to price.",
        "items": {
          "type": "object",
          "properties": {
            "label": {"type": "string", "description": "Display label (max 120 chars)."},
            "product_id": {"type": "string", "description": "Product UUID (optional)."},
            "bundle_id": {"type": "string", "description": "Bundle UUID (optional)."},
            "cost_ngn": {"type": "number", "minimum": 0, "description": "Unit cost in NGN. REQUIRED per entry."},
            "freight_ngn": {"type": "number", "minimum": 0},
            "discount_loss_pct": {"type": "number", "minimum": 0, "maximum": 1},
            "gateway_fee_pct": {"type": "number", "minimum": 0, "maximum": 1},
            "gateway_fee_fixed": {"type": "number", "minimum": 0},
            "floor_ngn": {"type": "number", "minimum": 0},
            "charm_strategy": {"type": "string", "enum": ["thousand_up", "k_minus_one", "nine_ninety", "round_50"]}
          },
          "required": ["cost_ngn"]
        }
      }
    },
    "required": ["id", "target_margin_pct", "inputs"]
  }'::jsonb,
  description = 'Read the cost vault and pricing floor, then propose safe NGN discounts per bundle, the quantity-tier ladder, and the escalating cart upsell offers. Refuses prices that breach pricing_floors.min_price. Returns the full breakdown so the CEO can see the maths. Requires the campaign id — look it up with query_campaigns_recent if unknown.',
  examples = '[
    {"utterance": "Suggest bundle discounts targeting 25% net margin",
     "payload":   {"id": "<campaign_id from query_campaigns_recent>", "target_margin_pct": 0.25, "include_charm_rounding": true,
                   "inputs": [{"label": "3-bundle deal", "cost_ngn": 90000}]}}
  ]'::jsonb
WHERE action_key = 'sales_campaigns.suggest_discount_math';

UPDATE shared.ai_action_catalogue SET
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string", "description": "Campaign UUID (campaign_id). REQUIRED. If unknown, call query_campaigns_recent first and use its campaign_id."},
      "question": {"type": "string", "description": "The plain-English pricing question (max 1000 chars)."},
      "proposed_price_ngn": {"type": "number", "minimum": 0, "description": "Price being tested, in NGN."},
      "floor_ngn": {"type": "number", "minimum": 0, "description": "Floor to test against, if known."},
      "product_id": {"type": "string", "description": "Product UUID the question is about (optional)."}
    },
    "required": ["id", "question"]
  }'::jsonb,
  description = 'Answer plain-English pricing questions ("Will 149,000 naira break the floor?", "What is my margin if I price the 5-bundle at 400k?") by calling the pricing engine read-only. Never writes anything. Requires the campaign id — look it up with query_campaigns_recent if unknown.',
  examples = '[
    {"utterance": "Is 149,000 naira above the floor on the HD Lace Front?",
     "payload":   {"id": "<campaign_id from query_campaigns_recent>", "question": "Is 149,000 above the floor on the HD Lace Front?", "proposed_price_ngn": 149000}}
  ]'::jsonb
WHERE action_key = 'sales_campaigns.dry_run_pricing';

UPDATE shared.ai_action_catalogue SET
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string", "description": "Campaign UUID (campaign_id). REQUIRED. If unknown, call query_campaigns_recent first and use its campaign_id."},
      "question": {"type": "string", "description": "The plain-English analytics question about this campaign (max 1000 chars)."}
    },
    "required": ["id", "question"]
  }'::jsonb,
  description = 'Answer natural-language questions about a running or ended campaign ("Which bundle sold most yesterday?", "Why did conversion drop after 3pm?"). Returns answer text + supporting numbers + optional causal hypotheses with explicit uncertainty disclaimers. Requires the campaign id — look it up with query_campaigns_recent if unknown.',
  examples = '[
    {"utterance": "Why did add-to-cart fall after 3pm yesterday?",
     "payload":   {"id": "<campaign_id from query_campaigns_recent>", "question": "Why did add-to-cart fall after 3pm yesterday?"}}
  ]'::jsonb
WHERE action_key = 'sales_campaigns.analytics_qna';

UPDATE shared.ai_action_catalogue SET
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string", "description": "Campaign UUID (campaign_id). REQUIRED. If unknown, call query_campaigns_recent first and use its campaign_id."}
    },
    "required": ["id"]
  }'::jsonb,
  description = 'Compose the morning briefing (yesterday''s numbers, top 3 movers, one recommended action). Used by the scheduler that emails the CEO at 8am during a live campaign. Read-only. Requires the campaign id — look it up with query_campaigns_recent if unknown.',
  examples = '[
    {"utterance": "Give me today''s briefing for the flash sale",
     "payload":   {"id": "<campaign_id from query_campaigns_recent>"}}
  ]'::jsonb
WHERE action_key = 'sales_campaigns.daily_briefing';

-- Verify:
--   SELECT action_key,
--          payload_schema ? 'required'                    AS has_required,
--          payload_schema->'properties' ? 'id'            AS schema_has_id
--     FROM shared.ai_action_catalogue
--    WHERE module = 'sales_campaigns'
--    ORDER BY action_key;
