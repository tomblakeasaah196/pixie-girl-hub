-- ============================================================
-- 000358_shared_marketing_officer_campaign_team_scope
-- Pixie Girl Hub · V2.2 · RBAC — Marketing team can see & work the
-- whole team's sales campaigns (not just their own).
--
-- WHY. 000348 seeded `marketing_officer` with sales_campaigns at level
-- `co` = view/create/edit @ OWN scope. campaigns.repo.findAll narrows any
-- non-`all` scope to `created_by = caller`, and getById 404s a campaign the
-- caller didn't author. Net effect: an officer who opens Sales Campaigns
-- sees ONLY the campaigns they personally created — a campaign built by a
-- teammate (or the CEO) is invisible to them, so they cannot open, edit or
-- submit it for approval. That contradicts how the department actually works:
-- campaigns are a shared, brand-wide marketing surface — anyone on the team
-- builds, edits and submits; the manager (or CEO) approves.
--
-- FIX. Widen the officer's sales_campaigns view/create/edit to `all` scope so
-- the whole Marketing team shares one campaign board. The approve/delete/
-- export gates are unchanged — the officer still cannot approve or launch
-- (that stays marketing_manager `full` @ all + CEO), so submit-for-approval →
-- manager/CEO approves still holds. marketing_manager already had `all` scope,
-- so it is untouched.
--
-- Idempotent: the UPDATE is a no-op once the scope is already `all`, and it is
-- guarded to the resolved marketing_officer role_id (adopts the prod row).
-- The runner wraps each file in its own BEGIN/COMMIT, so this does NOT
-- self-wrap.
-- ============================================================

UPDATE shared.permissions
   SET record_scope = 'all'
 WHERE role_id = (
         SELECT role_id FROM shared.roles
          WHERE role_name = 'marketing_officer' AND business IS NULL
          LIMIT 1
       )
   AND module = 'sales_campaigns'
   AND action IN ('view', 'create', 'edit')
   AND record_scope <> 'all';

-- Verify (expect all three rows @ all):
--   SELECT action, record_scope
--     FROM shared.permissions p
--     JOIN shared.roles r USING (role_id)
--    WHERE r.role_name = 'marketing_officer' AND r.business IS NULL
--      AND p.module = 'sales_campaigns'
--    ORDER BY action;
