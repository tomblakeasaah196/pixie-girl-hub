-- ============================================================
-- MIGRATION 000344 — Retire E-Commerce (storefront admin) & Intercompany permissions
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Owner directive (2026-07-15): the E-Commerce admin and Intercompany modules
-- were killed (out of scope for single-business tenants) but their permission
-- keys still showed in the Org & Workflow role matrix and carried seeded grants.
--
-- This purges both modules from the RBAC vocabulary and removes every seeded
-- grant that referenced them, so they disappear from the permission matrix and
-- the CEO full-access re-seed (000210) can no longer re-grant them.
--
-- Scope notes:
--   * `storefront` here is the ADMIN permission key only. The PUBLIC storefront
--     (cart, checkout, catalogue, reviews, sitemap under /api/public/storefront)
--     is unauthenticated and unaffected. `storefront_studio` is a separate,
--     live module and is left intact.
--   * The JS single-source-of-truth (src/shared/access/access.catalog.js) has
--     the matching entries removed in the same change, so the matrix UI and the
--     grant validator no longer accept these keys either.
--
-- Reversible: re-add the two rows to shared.permission_module_keys and the
-- catalog entries if a future client re-enables these modules.
-- ============================================================

-- 1. Remove every role's grants for the retired modules.
DELETE FROM shared.permissions
 WHERE module IN ('storefront', 'intercompany');

-- 2. Remove the modules from the RBAC vocabulary table so seed/re-seed jobs
--    (e.g. 000210 CEO full access, which INSERTs FROM permission_module_keys)
--    stop reintroducing them.
DELETE FROM shared.permission_module_keys
 WHERE module_key IN ('storefront', 'intercompany');
