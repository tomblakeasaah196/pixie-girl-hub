-- ============================================================
-- 000254 — Shade Finder feature flag
-- Pixie Girl Hub · JBS Praxis
--
-- Registers the public Praxis Shade Match feature (photo → shade + product
-- recommendation on the Storefront Website) in AI Governance so:
--   * it can be toggled off storefront-wide from the admin,
--   * its Gemini calls land in shared.ai_usage_ledger (user_id NULL — the
--     callers are anonymous visitors) and count against the monthly budget.
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO shared.ai_feature_flags
  (feature_key, display_name, description, is_enabled,
   default_provider, default_model, est_cost_per_call_ngn)
VALUES
  ('shade_finder', 'Shade Finder (storefront)',
   'Public Praxis shade match: a visitor uploads a photo, Gemini vision reads colour attributes, and the reply recommends a live shade + styled products. Two model calls per analysis (vision + advice).',
   true, 'gemini', 'gemini-2.5-flash', 2.00)
ON CONFLICT (feature_key) DO NOTHING;
