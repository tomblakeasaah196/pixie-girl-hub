-- ============================================================
-- MIGRATION 000388 — shared.preorder_allocation_runs
-- Pixie Girl Hub · Pre-order stock auto-deduction (safety-net audit)
--
-- The pre-order allocator runs live (outbox: stock.received → allocate) and is
-- also swept on every deploy by scripts/backfill-preorder-allocations.js — a
-- self-healing reconcile so that if the live path ever fails (worker down,
-- handler bug), the next deploy still applies any stock that arrived to the
-- pre-orders waiting on it. The reconcile is idempotent (coverage is re-derived
-- from the stock movement ledger each pass, so it only ever allocates a genuine
-- deficit against genuinely-available stock — running it twice never
-- double-draws), and this table is its run log: it lets the script answer "has
-- a full historical backfill ever completed for this brand?" and gives ops a
-- durable trace of every sweep.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.preorder_allocation_runs (
  run_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT        NOT NULL,                         -- brand schema
  mode              TEXT        NOT NULL DEFAULT 'deploy'
                    CHECK (mode IN ('deploy','manual','historical','event')),
  variants_scanned  INTEGER     NOT NULL DEFAULT 0,
  orders_fulfilled  INTEGER     NOT NULL DEFAULT 0,               -- orders whose last preorder line cleared
  units_deducted    INTEGER     NOT NULL DEFAULT 0,               -- drawn for paid pre-orders
  units_reserved    INTEGER     NOT NULL DEFAULT 0,               -- held for unpaid pre-orders
  ok                BOOLEAN     NOT NULL DEFAULT true,            -- run completed without error
  notes             TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);

-- "Latest run for this brand" and "has any successful run ever happened".
CREATE INDEX IF NOT EXISTS idx_preorder_allocation_runs_business
  ON shared.preorder_allocation_runs (business, started_at DESC);

-- ============================================================
-- Verify
--   SELECT to_regclass('shared.preorder_allocation_runs');  -- non-null
-- ============================================================
