-- ============================================================
-- 000255 — Shop AI Search feature flag
-- Pixie Girl Hub · JBS Praxis
--
-- Registers the public "ask Praxis" natural-language shop search (the shop
-- page search box — plain keywords OR a real-life ask like "what should I
-- wear for a first date") in AI Governance so:
--   * it can be toggled off storefront-wide from the admin,
--   * its Gemini calls land in shared.ai_usage_ledger (user_id NULL — the
--     callers are anonymous visitors) and count against the monthly budget.
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO shared.ai_feature_flags
  (feature_key, display_name, description, is_enabled,
   default_provider, default_model, est_cost_per_call_ngn)
VALUES
  ('shop_ai_search', 'Shop AI Search (storefront)',
   'Public "ask Praxis" shop search: a visitor types plain keywords or a real-life ask ("wear for a first date"), Gemini reads intent against a digest of the live catalogue, and replies with a ranked pick of real, live products. One model call per search turn.',
   true, 'gemini', 'gemini-2.5-flash', 0.50)
ON CONFLICT (feature_key) DO NOTHING;
