-- ============================================================
-- MIGRATION 000218 — AI Model Catalogue + Gemini vendor
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- PR 5 lifts model + pricing out of code into data:
--
--   1. Adds `gemini` to ai_vendor_credentials.vendor.
--   2. Introduces shared.ai_model_catalogue — one row per
--      (vendor, model_id). The CEO picks a model from this list in
--      AI Control → Vendors; the spend meter reads the cost rows
--      from here so the day after Google bumps a price the bill
--      recomputes from the next call.
--   3. Seeds current (Jan-2026 best-known) rates for DeepSeek,
--      Gemini and OpenAI. Editable in the UI — no code redeploy
--      when prices move.
--   4. Adds `current_model` to ai_vendor_credentials so each vendor
--      row points at the model the CEO has selected. Falls back to
--      the catalogue row flagged `is_default`.
--
-- Pricing convention: NGN per 1M tokens (input + output split). The
-- per-call cost is `(input_tokens × input_cost + output_tokens ×
-- output_cost) / 1,000,000`. Embeddings only use input_cost (no
-- output tokens). Audio (Whisper-style) uses `cost_per_audio_minute_ngn`
-- on the row.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. ai_vendor_credentials — widen vendor enum + add current_model  ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.ai_vendor_credentials
  DROP CONSTRAINT IF EXISTS ai_vendor_credentials_vendor_check;
ALTER TABLE shared.ai_vendor_credentials
  ADD CONSTRAINT ai_vendor_credentials_vendor_check
    CHECK (vendor IN ('deepseek','groq','openai','gemini','self_hosted','other'));

ALTER TABLE shared.ai_vendor_credentials
  ADD COLUMN IF NOT EXISTS current_model TEXT;

COMMENT ON COLUMN shared.ai_vendor_credentials.current_model IS
  'Model id (matches ai_model_catalogue.model_id) the CEO has selected '
  'for this vendor. NULL = use the catalogue row flagged is_default. '
  'Switching this column is the cost-control lever — no code change.';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. ai_model_catalogue — model id × cost-per-1M tokens             ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.ai_model_catalogue (
  model_id                    TEXT        PRIMARY KEY,
  vendor                      TEXT        NOT NULL
                              CHECK (vendor IN ('deepseek','groq','openai','gemini','self_hosted','other')),
  display_name                TEXT        NOT NULL,
  family                      TEXT,                                   -- 'chat' | 'embedding' | 'audio'
  capability                  TEXT        NOT NULL DEFAULT 'chat'
                              CHECK (capability IN ('chat','embedding','audio','vision')),
  context_window              INTEGER,
  supports_tools              BOOLEAN     NOT NULL DEFAULT false,
  supports_streaming          BOOLEAN     NOT NULL DEFAULT true,
  -- Pricing (NGN per 1M tokens). Input/output for chat; only input for
  -- embeddings. Audio uses cost_per_audio_minute_ngn.
  input_cost_per_1m_ngn       NUMERIC(12,4) NOT NULL DEFAULT 0,
  output_cost_per_1m_ngn      NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_per_audio_minute_ngn   NUMERIC(12,4) NOT NULL DEFAULT 0,
  -- Default per (vendor, capability) — exactly one row per group should
  -- carry is_default=true. The UI enforces; the DB indexes it.
  is_default                  BOOLEAN     NOT NULL DEFAULT false,
  is_active                   BOOLEAN     NOT NULL DEFAULT true,
  notes                       TEXT,
  updated_by                  UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_model_catalogue_vendor
  ON shared.ai_model_catalogue (vendor, capability) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_model_catalogue_default
  ON shared.ai_model_catalogue (vendor, capability)
  WHERE is_default = true AND is_active = true;
CREATE TRIGGER trg_ai_model_catalogue_updated_at
  BEFORE UPDATE ON shared.ai_model_catalogue
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. Seed — current (Jan 2026) public rates                          ║
-- ╚════════════════════════════════════════════════════════════════════╝
--
-- NGN per 1M tokens, rounded conservatively. The CEO edits these in
-- AI Control → Models when Google/OpenAI/DeepSeek bump prices.

INSERT INTO shared.ai_model_catalogue
  (model_id, vendor, display_name, family, capability, context_window,
   supports_tools, input_cost_per_1m_ngn, output_cost_per_1m_ngn, is_default, notes)
VALUES
  -- ── DeepSeek (primary — cheapest reasonable quality) ─────────
  ('deepseek-chat',     'deepseek', 'DeepSeek Chat',     'chat', 'chat',
   128000, true,    420.00,     1680.00, true,
   'Primary cheap-and-good general chat model.'),
  ('deepseek-reasoner', 'deepseek', 'DeepSeek Reasoner', 'chat', 'chat',
   128000, true,    840.00,     3360.00, false,
   'Reasoning model — more expensive, only worth it for complex tasks.'),

  -- ── Gemini (fallback) ────────────────────────────────────────
  ('gemini-2.5-flash-lite', 'gemini', 'Gemini 2.5 Flash Lite', 'chat', 'chat',
   1000000, true,   150.00,     600.00, false,
   'Cheapest Gemini chat model — good for Smartcomm drafts.'),
  ('gemini-2.5-flash',      'gemini', 'Gemini 2.5 Flash',      'chat', 'chat',
   1000000, true,   450.00,     3600.00, true,
   'Default Gemini chat model — fallback when DeepSeek fails.'),
  ('gemini-2.5-pro',        'gemini', 'Gemini 2.5 Pro',        'chat', 'chat',
   2000000, true,  1875.00,    15000.00, false,
   'Heavyweight Gemini — only worth it for hard reasoning tasks.'),

  -- ── OpenAI (alternative + embeddings) ────────────────────────
  ('gpt-4o-mini',         'openai', 'GPT-4o mini',           'chat', 'chat',
   128000, true,    225.00,     900.00, false,
   'Cheap OpenAI chat — comparable to Gemini Flash Lite.'),
  ('gpt-4o',              'openai', 'GPT-4o',                'chat', 'chat',
   128000, true,   3750.00,   15000.00, true,
   'OpenAI default — expensive, use sparingly.'),
  ('text-embedding-3-small', 'openai', 'OpenAI Embedding 3-small', 'embedding', 'embedding',
   8192,  false,    30.00,       0.00, true,
   'Cheap, high-quality embeddings. The CEO already configured this.'),
  ('text-embedding-3-large', 'openai', 'OpenAI Embedding 3-large', 'embedding', 'embedding',
   8192,  false,   195.00,       0.00, false,
   'Higher-quality embeddings — 6.5× the cost.')
ON CONFLICT (model_id) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 4. Seed default ai_vendor_credentials rows where missing           ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- This is empty by default — the CEO adds vendor rows in AI Control →
-- Vendors. We DON'T pre-create them since they'd hold empty API keys.

-- ============================================================
-- Verify
--   SELECT vendor, model_id, display_name, is_default,
--          input_cost_per_1m_ngn, output_cost_per_1m_ngn
--     FROM shared.ai_model_catalogue
--    ORDER BY vendor, capability, is_default DESC;
-- ============================================================
