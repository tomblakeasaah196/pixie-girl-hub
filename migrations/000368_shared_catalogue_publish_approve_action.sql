-- ============================================================
-- 000368_shared_catalogue_publish_approve_action
-- Pixie Girl Hub · JBS Praxis
--
-- WHY. Styled-product publish/unpublish (routes.js, P0-6) was gated on a
-- bespoke `catalogue.publish` action instead of the standard `approve`
-- action that every other "publish"-style endpoint in the codebase uses
-- (storefront_studio theme/nav/page/content publish, social post publish,
-- email_campaigns send, retail_partners settlements — all gated on
-- `approve`). `publish` was never added to the RBAC action vocabulary
-- (src/shared/access/access.catalog.js ACTIONS = view/create/edit/delete/
-- approve/export), so:
--
--   1. The Roles UI (Settings → Org & Workflow) can't render a toggle for
--      it — the matrix only iterates the vocabulary's action list — so no
--      admin could ever grant "publish styled products" to a role from
--      the app, not even via the "Full access" bulk button.
--   2. A direct API grant attempt is rejected server-side
--      (access.service.js isValidAction → "Unknown action 'publish'").
--   3. It only ever worked for the three roles migration 000103 hardcoded
--      it to directly in SQL (owner/admin/manager). Every role created
--      since — including custom roles made through the Roles UI, e.g. a
--      `chief_operating_officer` role with catalogue edit access — could
--      never get it, so Publish/Unpublish/Archive/"Publish to campaign"
--      (all four gated on the same canPublish flag) silently never render
--      for them. Not a regression — it was never reachable for those roles.
--
-- catalogue.routes.js and the frontend (StyledProductPage.tsx) now check
-- `approve` instead. This migration re-points existing grants so nothing
-- that could publish yesterday loses the ability today, and removes the
-- now-dead `publish` rows (mirrors the cleanup approach of 000311).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- Backfill: anyone who held catalogue:publish now holds catalogue:approve.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT role_id, module, 'approve', record_scope
FROM shared.permissions
WHERE module = 'catalogue' AND action = 'publish'
ON CONFLICT (role_id, module, action) DO NOTHING;

-- Drop the orphaned action — nothing enforces `catalogue.publish` any more,
-- and it was never part of the vocabulary the Roles UI or the API validate
-- against.
DELETE FROM shared.permissions
WHERE module = 'catalogue' AND action = 'publish';

-- ============================================================
-- Verify (should return zero rows):
--   SELECT * FROM shared.permissions WHERE module = 'catalogue' AND action = 'publish';
--
-- Verify owner/admin/manager kept the ability (should return 3 rows):
--   SELECT role_id FROM shared.permissions
--    WHERE module = 'catalogue' AND action = 'approve'
--      AND role_id IN (
--        '11111111-1111-1111-1111-000000000001',
--        '11111111-1111-1111-1111-000000000002',
--        '11111111-1111-1111-1111-000000000003'
--      );
--
-- Follow-up (not this migration): grant catalogue:approve to any other
-- role that should be able to publish styled products (e.g. a COO custom
-- role) via Settings → Org & Workflow → Roles — it's now a normal toggle.
-- ============================================================
