-- ============================================================
-- 000116_shared_payment_gateways
-- B (PD §6.21) — per-business payment-gateway configuration: credentials
-- (encrypted at rest), active/primary/fallback status, supported currencies.
-- CEO-managed in Business Setup. The fee SCHEDULE already lives in
-- business_config.payment_gateway_fees (§6.25) — not duplicated here.
--
-- Paystack + OPay are the local-NGN pair: one 'primary', one 'fallback' (auto
-- failover at checkout). Nomba (POS) and Stripe (international) are
-- 'standalone'. Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.payment_gateways (
  gateway_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  provider              TEXT        NOT NULL
                        CHECK (provider IN ('paystack','opay','nomba','stripe')),
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  -- Redundancy role for the local-NGN pair; nomba/stripe are 'standalone'.
  role                  TEXT        NOT NULL DEFAULT 'standalone'
                        CHECK (role IN ('primary','fallback','standalone')),
  -- AES-256-GCM blob (encryption.service) of a JSON credential bag:
  -- { secret_key, public_key, merchant_id, account_id, client_id, webhook_secret, ... }
  credentials_enc       TEXT,
  supported_currencies  TEXT[]      NOT NULL DEFAULT ARRAY['NGN'],
  display_label         TEXT,
  configured_by         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, provider)
);

DROP TRIGGER IF EXISTS trg_payment_gateways_updated_at ON shared.payment_gateways;
CREATE TRIGGER trg_payment_gateways_updated_at
  BEFORE UPDATE ON shared.payment_gateways
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- At most one active 'primary' per business (the local-pair head).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_gateways_primary
  ON shared.payment_gateways (business)
  WHERE role = 'primary' AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_payment_gateways_business
  ON shared.payment_gateways (business, is_active);
