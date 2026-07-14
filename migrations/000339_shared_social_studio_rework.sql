-- ============================================================
-- MIGRATION 000339 — Social Studio rework (manual-first proof-of-publish)
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Replaces the Graph/TikTok/YouTube auto-publish design (blocked indefinitely
-- on Meta app review) with a manual-first "proof of publish" model: creators
-- post natively from their own device, then prove it in the Hub with a link
-- (verified server-side via oEmbed/OpenGraph — no OAuth) plus a screenshot.
--
-- Changes:
--   social_posts          — new status vocabulary, proof/verification fields,
--                            dual scoring (data + creative), assignment,
--                            nudge/escalation tracking, plan linkage
--   social_content_plans  — NEW: the monthly batch a creator submits for a
--                            single CEO approval (workflow-gated)
--   social_targets        — NEW: CEO-set monthly post targets per platform,
--                            optionally per creator (NULL user_id = team-wide)
--   social_accounts       — drops OAuth token storage (nothing to auto-publish
--                            with any more); becomes a plain handle registry
--                            used to sanity-check a pasted proof link's author
--                            against the brand's actual account
--
-- Idempotent: guarded with IF EXISTS / IF NOT EXISTS throughout.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. social_content_plans — the monthly batch, submitted as ONE entity ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.social_content_plans (
  plan_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  period_start          DATE        NOT NULL,
  period_end            DATE        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_approval','approved','changes_requested')),
  post_count            SMALLINT    NOT NULL DEFAULT 0,
  workflow_instance_id  UUID,
  submitted_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  submitted_at          TIMESTAMPTZ,
  decided_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  decided_at            TIMESTAMPTZ,
  decision_notes        TEXT,
  created_by            UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_social_content_plans_updated_at') THEN
    CREATE TRIGGER trg_social_content_plans_updated_at
      BEFORE UPDATE ON shared.social_content_plans
      FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_social_content_plans_business
  ON shared.social_content_plans (business, status, period_start DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. social_posts — status rework, proof/verification, dual scoring   ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Remap existing statuses before the CHECK constraint changes shape:
--   published  -> posted    (proof-verified, same meaning as before)
--   failed     -> flagged   (was an API failure; now "deadline missed / no proof")
--   publishing -> scheduled (transient API state no longer exists)
--   deleted    -> archived
UPDATE shared.social_posts SET status = 'posted'    WHERE status = 'published';
UPDATE shared.social_posts SET status = 'flagged'   WHERE status = 'failed';
UPDATE shared.social_posts SET status = 'scheduled' WHERE status = 'publishing';
UPDATE shared.social_posts SET status = 'archived'  WHERE status = 'deleted';

ALTER TABLE shared.social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE shared.social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('draft','assigned','scheduled','posted','flagged','archived'));

ALTER TABLE shared.social_posts
  ADD COLUMN IF NOT EXISTS assigned_to            UUID REFERENCES shared.users (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_id                UUID REFERENCES shared.social_content_plans (plan_id) ON DELETE SET NULL,
  -- Proof of publish: the pasted link lives in the existing external_url
  -- column (renamed conceptually, not structurally); external_post_id now
  -- holds whatever ID the oEmbed response exposes (shortcode / video id).
  ADD COLUMN IF NOT EXISTS proof_screenshot_url   TEXT,
  ADD COLUMN IF NOT EXISTS oembed_html            TEXT,
  ADD COLUMN IF NOT EXISTS oembed_thumbnail_url   TEXT,
  ADD COLUMN IF NOT EXISTS oembed_author_handle   TEXT,
  ADD COLUMN IF NOT EXISTS oembed_verified_at     TIMESTAMPTZ,
  -- Soft warning (not a hard block) when the oEmbed author doesn't match any
  -- registered handle for the platform — oEmbed author fields aren't fully
  -- consistent across platforms, so we flag for review rather than reject.
  ADD COLUMN IF NOT EXISTS handle_mismatch        BOOLEAN NOT NULL DEFAULT false,
  -- Dual Post Grade: creative (manager, subjective) + performance (formula, objective) — never blended.
  ADD COLUMN IF NOT EXISTS creative_rating        SMALLINT CHECK (creative_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS creative_rated_by      UUID REFERENCES shared.users (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creative_rated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS performance_score      NUMERIC(5,2) CHECK (performance_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS performance_computed_at TIMESTAMPTZ,
  -- Deadline enforcement bookkeeping (mirrors the CoS accountability sweep).
  ADD COLUMN IF NOT EXISTS flag_reason            TEXT,
  ADD COLUMN IF NOT EXISTS nudge_count            SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_nudged_at         TIMESTAMPTZ;

-- Retired: no more outbound API calls, so no automated retries or API failure
-- text to track — flag_reason above replaces failure_message's job.
ALTER TABLE shared.social_posts DROP COLUMN IF EXISTS retry_count;
ALTER TABLE shared.social_posts DROP COLUMN IF EXISTS failure_message;

DROP INDEX IF EXISTS shared.idx_social_posts_published;
CREATE INDEX IF NOT EXISTS idx_social_posts_posted
  ON shared.social_posts (business, platform, published_at DESC)
  WHERE status = 'posted';
CREATE INDEX IF NOT EXISTS idx_social_posts_flagged
  ON shared.social_posts (business, scheduled_for)
  WHERE status = 'flagged';
CREATE INDEX IF NOT EXISTS idx_social_posts_assigned
  ON shared.social_posts (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_plan
  ON shared.social_posts (plan_id) WHERE plan_id IS NOT NULL;
-- The deadline sweep's core query: due, unproven, still schedulable posts.
CREATE INDEX IF NOT EXISTS idx_social_posts_due_unposted
  ON shared.social_posts (business, scheduled_for)
  WHERE status = 'scheduled';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. social_targets — CEO-set monthly post targets                    ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.social_targets (
  target_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  platform      TEXT        NOT NULL CHECK (platform IN ('instagram','facebook','tiktok','youtube')),
  -- NULL = a team-wide target for this platform/month; set = a per-creator target.
  user_id       UUID        REFERENCES shared.users (user_id) ON DELETE CASCADE,
  period_month  DATE        NOT NULL,
  target_count  SMALLINT    NOT NULL CHECK (target_count > 0),
  set_by        UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (business, platform, user_id, period_month)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_social_targets_updated_at') THEN
    CREATE TRIGGER trg_social_targets_updated_at
      BEFORE UPDATE ON shared.social_targets
      FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_social_targets_lookup
  ON shared.social_targets (business, period_month DESC, platform);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 4. social_accounts — drop OAuth storage, become a handle registry   ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_business_platform_external_account_id_key;
ALTER TABLE shared.social_accounts
  ADD COLUMN IF NOT EXISTS profile_url TEXT;
ALTER TABLE shared.social_accounts
  DROP COLUMN IF EXISTS access_token_enc,
  DROP COLUMN IF EXISTS refresh_token_enc,
  DROP COLUMN IF EXISTS token_expires_at,
  DROP COLUMN IF EXISTS scopes,
  DROP COLUMN IF EXISTS external_account_id,
  DROP COLUMN IF EXISTS last_sync_at;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_business_platform_handle_key'
  ) THEN
    ALTER TABLE shared.social_accounts
      ADD CONSTRAINT social_accounts_business_platform_handle_key UNIQUE (business, platform, handle);
  END IF;
END $$;

-- ============================================================
-- Verify
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'shared' AND table_name = 'social_posts'
-- AND column_name IN ('assigned_to','plan_id','proof_screenshot_url','performance_score');
-- Expected: 4 rows
-- ============================================================
