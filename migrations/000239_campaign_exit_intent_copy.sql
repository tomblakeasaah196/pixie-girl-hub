-- Add editable copy fields for the exit-intent modal (title, body, button label).
-- These let the campaign owner customise the popup text from the builder,
-- instead of relying on the hardcoded defaults.

ALTER TABLE shared.sales_campaigns
  ADD COLUMN IF NOT EXISTS exit_intent_title   TEXT,
  ADD COLUMN IF NOT EXISTS exit_intent_body    TEXT,
  ADD COLUMN IF NOT EXISTS exit_intent_button  TEXT;

-- Also add per-brand cart/checkout button colour overrides (stored on the
-- landing_pages config JSONB, but adding explicit columns on the brand
-- landing config is NOT needed — those live in the JSONB theme object).
