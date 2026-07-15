-- ============================================================
-- MIGRATION 000342 — Social accounts: Apify scrape fields + dynamic platform FK
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Extends shared.social_accounts (the brand handle registry from 000339)
-- with the fields the twice-daily Apify scrape needs to write to, and swaps
-- its hardcoded platform CHECK for a foreign key into the new
-- shared.social_platforms registry (000340) so a newly-registered platform
-- doesn't need a schema change to be usable here.
--
-- shared.social_posts / shared.social_targets keep their existing
-- instagram/facebook/tiktok/youtube CHECK constraints — this migration only
-- touches the account registry + metrics, not the posting/targets workflow,
-- which is out of scope for the Apify metrics feature.
--
-- Idempotent: guarded with IF NOT EXISTS / DO blocks throughout.
-- ============================================================

ALTER TABLE shared.social_accounts
  ADD COLUMN IF NOT EXISTS follower_count      BIGINT,
  ADD COLUMN IF NOT EXISTS bio                  TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url           TEXT,
  -- Full raw metric bag for whatever else that platform's actor returned
  -- (secondary stat tiles, future fields) — normalised follower_count/bio
  -- above are pulled out of this for the primary dashboard display, nothing
  -- from the actor's response is discarded.
  ADD COLUMN IF NOT EXISTS metrics              JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scrape_enabled        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_scraped_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_scrape_status    TEXT,
  ADD COLUMN IF NOT EXISTS last_scrape_error     TEXT;

ALTER TABLE shared.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_last_scrape_status_check;
ALTER TABLE shared.social_accounts ADD CONSTRAINT social_accounts_last_scrape_status_check
  CHECK (last_scrape_status IS NULL OR last_scrape_status IN ('ok', 'error'));

-- Swap the inline platform CHECK for a real FK. Existing rows only ever
-- carry 'instagram'/'facebook'/'tiktok'/'youtube', which 000340 already
-- seeded, so this is a safe drop-in.
ALTER TABLE shared.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_platform_fkey'
  ) THEN
    ALTER TABLE shared.social_accounts
      ADD CONSTRAINT social_accounts_platform_fkey
      FOREIGN KEY (platform) REFERENCES shared.social_platforms (platform_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_accounts_scrape_due
  ON shared.social_accounts (platform)
  WHERE scrape_enabled = true AND is_active = true;

-- ============================================================
-- Verify
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'shared' AND table_name = 'social_accounts'
-- AND column_name IN ('follower_count','bio','metrics','last_scraped_at');
-- Expected: 4 rows
-- ============================================================
