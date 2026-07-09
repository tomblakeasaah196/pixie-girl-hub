-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AI Governance UI: tiered caps + per-brand + per-user + resting msg ║
-- ║                                                                    ║
-- ║ The Q7/Q8 answers boil down to: revenue features must die LAST.    ║
-- ║ Concretely:                                                        ║
-- ║   * Internal AI (Praxis chat, training, insight narration) is      ║
-- ║     gated by the ORIGINAL soft/hard cap.                           ║
-- ║   * Storefront AI (Shop AI Search, Shade Finder) is gated by its   ║
-- ║     OWN separate cap — so a Praxis training spike can never take   ║
-- ║     the storefront down again, and vice-versa.                     ║
-- ║   * Feature flags now scope per-brand (pxg / flh independently),   ║
-- ║     per-user daily cap for staff features, and carry a custom      ║
-- ║     "Praxis is resting" message that the storefront surfaces to    ║
-- ║     shoppers instead of a generic 503.                             ║
-- ║                                                                    ║
-- ║ Idempotent — safe to re-run.                                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── ai_budget_periods: split storefront cap + running totals ─────────
-- Nullable storefront caps mean "uncapped" (the storefront is never
-- blocked on spend — only on its own device/IP quotas). The CEO opts
-- in by setting a value.
ALTER TABLE shared.ai_budget_periods
  ADD COLUMN IF NOT EXISTS storefront_soft_cap_ngn      NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS storefront_hard_cap_ngn      NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS storefront_actual_spend_ngn  NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storefront_actual_calls_count INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storefront_soft_cap_breached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storefront_hard_cap_breached_at TIMESTAMPTZ;

COMMENT ON COLUMN shared.ai_budget_periods.storefront_hard_cap_ngn IS
  'Separate hard cap for storefront features (feature_scope=storefront). NULL means uncapped — storefront never blocks on spend, per Q7 "revenue features die last".';

-- ── ai_feature_flags: scope + per-brand + per-user + resting message ──
ALTER TABLE shared.ai_feature_flags
  ADD COLUMN IF NOT EXISTS feature_scope    TEXT NOT NULL DEFAULT 'internal'
                            CHECK (feature_scope IN ('internal','storefront')),
  ADD COLUMN IF NOT EXISTS enabled_for_pxg  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_for_flh  BOOLEAN NOT NULL DEFAULT true,
  -- Optional per-user daily cap on staff features. NULL / 0 → uncapped.
  -- Storefront features don't use this — they gate on device+IP quotas
  -- in Redis (see storefront/ai-search + shade_finder).
  ADD COLUMN IF NOT EXISTS daily_user_cap   INTEGER,
  -- Custom "Praxis is resting" copy shown to storefront shoppers when
  -- the feature is disabled or a cap is breached. NULL → the storefront
  -- falls back to its generic warm copy.
  ADD COLUMN IF NOT EXISTS resting_message  TEXT;

COMMENT ON COLUMN shared.ai_feature_flags.resting_message IS
  'Shown to shoppers when a storefront feature is disabled or over cap. Leave NULL to use the storefront default. Not shown for internal features (staff see a technical reason instead).';

-- Mark the known storefront features so caps + per-brand routing work
-- correctly. Idempotent — only touches the two rows that must be
-- 'storefront'.
UPDATE shared.ai_feature_flags
   SET feature_scope = 'storefront',
       resting_message = COALESCE(
         resting_message,
         'Praxis is resting for now — plain search still works, and your stylist is one click away on WhatsApp ✨'
       )
 WHERE feature_key IN ('shop_ai_search','shade_finder');

-- ── Trigger: also update storefront totals for storefront features ────
-- Reads feature_scope on the flag row and, if it's 'storefront', bumps
-- storefront_actual_spend_ngn + storefront_actual_calls_count instead
-- of the internal totals. The internal total remains for aggregate/
-- historical views; the two totals are enforced independently by
-- canUseFeature.
CREATE OR REPLACE FUNCTION shared.fn_ai_usage_rollup()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_scope TEXT;
BEGIN
  -- Upsert into the daily roll-up (unchanged from 000014).
  INSERT INTO shared.ai_usage_daily
    (metric_date, feature_key, vendor, user_id,
     calls_count, total_tokens, input_tokens, output_tokens, audio_seconds, cost_ngn,
     failed_calls_count, refreshed_at)
  VALUES
    (NEW.occurred_at::DATE, NEW.feature_key, NEW.provider, NEW.user_id,
     1, NEW.total_tokens, NEW.input_tokens, NEW.output_tokens, NEW.audio_seconds, NEW.cost_ngn,
     CASE WHEN NEW.was_successful THEN 0 ELSE 1 END, now())
  ON CONFLICT (metric_date, feature_key, vendor, user_id) DO UPDATE
    SET calls_count        = shared.ai_usage_daily.calls_count + 1,
        total_tokens       = shared.ai_usage_daily.total_tokens + EXCLUDED.total_tokens,
        input_tokens       = shared.ai_usage_daily.input_tokens + EXCLUDED.input_tokens,
        output_tokens      = shared.ai_usage_daily.output_tokens + EXCLUDED.output_tokens,
        audio_seconds      = shared.ai_usage_daily.audio_seconds + EXCLUDED.audio_seconds,
        cost_ngn           = shared.ai_usage_daily.cost_ngn + EXCLUDED.cost_ngn,
        failed_calls_count = shared.ai_usage_daily.failed_calls_count + EXCLUDED.failed_calls_count,
        refreshed_at       = now();

  -- Which totals to bump on the budget period? Look up the flag's
  -- scope; default to 'internal' if the flag row is missing.
  SELECT feature_scope INTO v_scope
    FROM shared.ai_feature_flags
   WHERE feature_key = NEW.feature_key;
  v_scope := COALESCE(v_scope, 'internal');

  IF NEW.period_id IS NOT NULL THEN
    IF v_scope = 'storefront' THEN
      UPDATE shared.ai_budget_periods
         SET storefront_actual_spend_ngn  = storefront_actual_spend_ngn + NEW.cost_ngn,
             storefront_actual_calls_count = storefront_actual_calls_count + 1,
             -- Also bump the aggregate total so historical/reporting
             -- queries keep working — this stays the "all-AI" number.
             actual_spend_ngn  = actual_spend_ngn + NEW.cost_ngn,
             actual_calls_count = actual_calls_count + 1
       WHERE period_id = NEW.period_id;
    ELSE
      UPDATE shared.ai_budget_periods
         SET actual_spend_ngn  = actual_spend_ngn + NEW.cost_ngn,
             actual_calls_count = actual_calls_count + 1
       WHERE period_id = NEW.period_id;
    END IF;
  ELSE
    -- Fallback: find the active period covering this date.
    IF v_scope = 'storefront' THEN
      UPDATE shared.ai_budget_periods
         SET storefront_actual_spend_ngn  = storefront_actual_spend_ngn + NEW.cost_ngn,
             storefront_actual_calls_count = storefront_actual_calls_count + 1,
             actual_spend_ngn  = actual_spend_ngn + NEW.cost_ngn,
             actual_calls_count = actual_calls_count + 1
       WHERE is_active = true
         AND NEW.occurred_at::DATE BETWEEN period_start AND period_end;
    ELSE
      UPDATE shared.ai_budget_periods
         SET actual_spend_ngn  = actual_spend_ngn + NEW.cost_ngn,
             actual_calls_count = actual_calls_count + 1
       WHERE is_active = true
         AND NEW.occurred_at::DATE BETWEEN period_start AND period_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger: storefront breach detection on totals update ─────────────
-- Mirrors the internal-cap trigger but on the storefront totals so the
-- Spend page can show "storefront soft cap breached" independently.
CREATE OR REPLACE FUNCTION shared.fn_ai_storefront_budget_check_breach()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.storefront_soft_cap_ngn IS NOT NULL
     AND NEW.storefront_actual_spend_ngn >= NEW.storefront_soft_cap_ngn
     AND OLD.storefront_actual_spend_ngn < NEW.storefront_soft_cap_ngn
     AND NEW.storefront_soft_cap_breached_at IS NULL THEN
    NEW.storefront_soft_cap_breached_at := now();
  END IF;

  IF NEW.storefront_hard_cap_ngn IS NOT NULL
     AND NEW.storefront_actual_spend_ngn >= NEW.storefront_hard_cap_ngn
     AND OLD.storefront_actual_spend_ngn < NEW.storefront_hard_cap_ngn
     AND NEW.storefront_hard_cap_breached_at IS NULL THEN
    NEW.storefront_hard_cap_breached_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_storefront_budget_check_breach ON shared.ai_budget_periods;
CREATE TRIGGER trg_ai_storefront_budget_check_breach
  BEFORE UPDATE OF storefront_actual_spend_ngn
  ON shared.ai_budget_periods
  FOR EACH ROW EXECUTE FUNCTION shared.fn_ai_storefront_budget_check_breach();
