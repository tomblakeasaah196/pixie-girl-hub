-- ============================================================
-- 000117_shared_cost_vault_grants
-- V2.2 §6.24 P0-1 — the owner-controlled "Cost Vault" access list.
--
-- The TRUE landed cost and supplier identity behind every product
-- variant live AES-256-GCM encrypted in <brand>.product_variant_cost_vault.
-- They are visible ONLY to the owner (is_ceo) or a user the owner has
-- EXPLICITLY granted here — regardless of that user's role. This is a
-- per-USER capability, deliberately NOT a role/permission: even an admin
-- or finance user sees nothing unless they hold a live grant. Only the
-- owner may write this table (enforced in the app, like ai_access_grants).
--
-- Modelled one-for-one on shared.ai_access_grants. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.cost_vault_grants (
  grant_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  -- Brand scope. A specific business_key, or '*' for every brand the
  -- owner runs. Kept as TEXT (not an FK) so '*' is expressible.
  business              TEXT        NOT NULL,
  granted_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  revoked_reason        TEXT,
  UNIQUE (user_id, business)
);

CREATE INDEX IF NOT EXISTS idx_cost_vault_grants_active
  ON shared.cost_vault_grants (user_id, business)
  WHERE revoked_at IS NULL;
