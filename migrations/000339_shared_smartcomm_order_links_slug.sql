-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 000339 — Smartcomm order links: short public slug                   ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Why: the shared-catalogue order link used to carry a full signed JWT in
-- the URL path (items + specs + prices), producing ~1,400-character links
-- that Instagram DM rejects ("message over 1000 characters", code 100
-- subcode 2534038). The link's payload already lives in this row, so the
-- URL never needed to carry it. We add a short, unguessable public slug
-- (base64url of 9 random bytes ≈ 12 chars, minted in the app) and route
-- the checkout at `/o/<slug>` — turning a 1.4 KB link into ~40 chars.
--
-- "Capture" mode is retired (owner, 2026-07): every link is now the
-- shared-catalogue mini-shop ("shop"). We flip the column default so new
-- rows land as 'shop'; the CHECK still accepts 'capture' so historic rows
-- keep validating.

BEGIN;

ALTER TABLE shared.smartcomm_order_links
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

-- New links are always the shared-catalogue mini-shop.
ALTER TABLE shared.smartcomm_order_links
  ALTER COLUMN mode SET DEFAULT 'shop';

-- Backfill a slug for any existing row so the column is never null once the
-- app starts minting slugs (old long JWT links are retired regardless).
-- md5(link_id) is deterministic + unique per row, so no collision here.
UPDATE shared.smartcomm_order_links
   SET public_slug = substr(md5(link_id::text), 1, 16)
 WHERE public_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_smartcomm_order_links_slug
  ON shared.smartcomm_order_links (public_slug)
  WHERE public_slug IS NOT NULL;

COMMIT;
