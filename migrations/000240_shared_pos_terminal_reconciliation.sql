-- ============================================================
-- 000234_shared_pos_terminal_reconciliation
-- Fallback 1 for in-store Nomba terminal payments.
--
-- A Nomba terminal/POS webhook that arrives without a usable order
-- reference (no merchantTxRef, or one that doesn't resolve to an order)
-- cannot be auto-confirmed. Rather than letting it loop in webhook-replay
-- until the retry cap, the webhook handler parks it here for staff to
-- match against an open in-store order by amount + terminal + time, then
-- confirm it against that order.
--
-- Shared (not brand-scoped) because webhooks are received before the brand
-- is known; `resolved_brand` is filled in when the terminal is recognised
-- in a brand's pos_terminals registry, and is NULL when still unknown.
-- ============================================================

CREATE TABLE shared.pos_terminal_reconciliation (
  recon_id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id          UUID          REFERENCES shared.webhook_log(webhook_id),
  provider            TEXT          NOT NULL DEFAULT 'nomba',
  resolved_brand      TEXT,                                   -- owning brand if the terminal is registered; NULL if unknown
  nomba_terminal_id   TEXT,                                   -- data.terminal.terminalId
  alias_account_name  TEXT,                                   -- data.transaction.aliasAccountName (e.g. "Faitlyn Salon de luxe")
  amount_ngn          NUMERIC(18,2) NOT NULL,                 -- webhook transactionAmount (Naira, major units)
  transaction_time    TIMESTAMPTZ,                            -- data.transaction.time
  provider_reference  TEXT,                                   -- transactionId / merchantTxRef / sessionId
  raw_payload         JSONB         NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','matched','ignored')),
  matched_brand       TEXT,
  matched_order_id    UUID,
  matched_by          UUID,
  matched_at          TIMESTAMPTZ,
  note                TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- One queue row per provider transaction so replayed/duplicate webhooks
-- enqueue at most once (idempotent ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX uq_pos_recon_provider_ref
  ON shared.pos_terminal_reconciliation (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

-- Staff worklist: pending items for a brand, newest first.
CREATE INDEX idx_pos_recon_pending
  ON shared.pos_terminal_reconciliation (resolved_brand, status, transaction_time DESC)
  WHERE status = 'pending';
