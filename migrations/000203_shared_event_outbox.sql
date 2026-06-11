-- ============================================================
-- MIGRATION 000203 — Transactional event outbox (H-2 / R-2 / A-1 / A-2)
--
-- Problem this fixes:
--   Domain events (order.paid, …) were emitted on an in-process EventEmitter
--   *inside* the still-open DB transaction (pre-commit), and consumers read on
--   a separate pooled connection that could not see the uncommitted row →
--   silent skips, no atomicity, no retry, no cross-process delivery.
--
-- Fix: services write an outbox row with the SAME client (atomic with the
--   business row); a post-commit dispatcher (src/shared/outbox + the worker
--   poller) reads committed rows and invokes registered handlers with
--   at-least-once delivery + backoff. Handlers see only committed state.
--
-- NOT under RLS on purpose: the dispatcher is cross-brand (it drains every
--   brand's events), so it must see all rows. The `business` column is carried
--   so the dispatcher can re-establish brand context per row.
--
-- Idempotent / re-runnable (CREATE … IF NOT EXISTS), matching the project's
-- no-tracking-table migration runner.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.event_outbox (
  event_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business        TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','failed')),
  attempts        SMALLINT    NOT NULL DEFAULT 0,
  max_attempts    SMALLINT    NOT NULL DEFAULT 10,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  -- Optional natural key so a duplicate enqueue (e.g. a retried markPaid)
  -- coalesces to one row instead of fanning out twice.
  dedup_key       TEXT,
  -- Per-handler progress: names of handlers that have already succeeded for
  -- this row. On retry the dispatcher skips these, so a consumer never re-runs
  -- (exactly-once per consumer) and one failing consumer can't re-trigger the
  -- side-effects of the ones that already succeeded.
  completed_handlers TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);

-- Claim index: only the rows a poller cares about (cheap, partial).
CREATE INDEX IF NOT EXISTS idx_event_outbox_due
  ON shared.event_outbox (next_attempt_at)
  WHERE status = 'pending';

-- Coalesce duplicate enqueues by natural key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_outbox_dedup
  ON shared.event_outbox (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Reclaim of stale 'processing' rows (after a worker crash) keys off updated_at.
CREATE INDEX IF NOT EXISTS idx_event_outbox_processing
  ON shared.event_outbox (updated_at)
  WHERE status = 'processing';
