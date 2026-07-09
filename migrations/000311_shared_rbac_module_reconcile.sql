-- ============================================================
-- 000311_shared_rbac_module_reconcile
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Make the RBAC data layer reflect reality. Over the build, modules were
-- renamed and retired (e.g. payroll→hr_payroll, campaigns→sales_campaigns,
-- workflow→org_workflow, stylists→stylist_programme, messaging→smartcomm,
-- and pos was dropped entirely). Old seed migrations left permission rows
-- keyed on names that NO route enforces any more, so the Access matrix kept
-- showing modules that no longer exist.
--
-- This purges every shared.permissions row whose module is not in the
-- canonical vocabulary — the exact set of requirePermission(module,...) keys
-- enforced in the codebase, which is also src/shared/access/access.catalog.js
-- MODULES. A module that nothing enforces cannot gate anything, so removing
-- its grants cannot change what any user is allowed to do; it only stops the
-- matrix from listing dead modules.
--
-- Keep this list identical to access.catalog.js MODULES. Regenerate with:
--   grep -rhoP 'requirePermission\(\s*"\K[a-z_]+' src/ --include="*.js" | sort -u
--
-- Idempotent — safe to re-run.
-- ============================================================

DELETE FROM shared.permissions
WHERE module NOT IN (
  'accounting',
  'ad_analytics',
  'ai_governance',
  'ai_insights',
  'attendance',
  'audit',
  'business_setup',
  'calendar',
  'catalogue',
  'contacts',
  'crm',
  'customer_onboarding',
  'dashboards',
  'documents',
  'email_campaigns',
  'expenses',
  'help_center',
  'hr_payroll',
  'iam',
  'intercompany',
  'invoicing',
  'logistics',
  'messaging_accounts',
  'org_workflow',
  'outbound_policy',
  'platform_settings',
  'praxis_ai',
  'pricing',
  'production',
  'purchasing',
  'retail_partners',
  'retention',
  'sales',
  'sales_campaigns',
  'service_catalogue',
  'service_jobs',
  'settings',
  'smartcomm',
  'social',
  'stock',
  'storefront',
  'storefront_studio',
  'stylist_programme',
  'tasks'
);

-- ============================================================
-- Verify (should return zero rows):
--   SELECT DISTINCT module FROM shared.permissions
--   WHERE module NOT IN (SELECT unnest(...canonical...));
-- ============================================================
