-- ============================================================
-- 000363 — Expense Receipt AI (inline Praxis capture) feature flag
-- Pixie Girl Hub · JBS Praxis
--
-- Registers the in-Expenses "scan a receipt / invoice + voice note → suggested
-- expense" feature in AI Governance so:
--   * it can be toggled off (globally or per brand) from AI Control,
--   * an optional per-user daily cap applies (feature_scope='internal'),
--   * its Gemini vision calls land in shared.ai_usage_ledger attributed to the
--     staff member + brand and count against the monthly internal budget.
--
-- feature_scope defaults to 'internal' (see 000310) — this is a staff feature,
-- NOT a storefront one, so it gates on the internal hard cap and per-user cap,
-- and staff see a technical reason (never the shopper "resting" copy) on block.
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO shared.ai_feature_flags
  (feature_key, display_name, description, is_enabled,
   default_provider, default_model, est_cost_per_call_ngn)
VALUES
  ('expense_receipt_ai', 'Expense Receipt AI',
   'In-Expenses Praxis capture: staff upload a receipt/invoice photo or PDF plus an optional voice note, Gemini vision reads the vendor, date, amount, VAT and line items (mapped to the brand''s real expense categories), and the Hub proposes a draft expense to review before it is created. One vision call per scan (plus one Whisper transcription when a voice note is attached).',
   true, 'gemini', 'gemini-2.5-flash', 3.00)
ON CONFLICT (feature_key) DO NOTHING;
