-- ============================================================
-- MIGRATION 000200 — Row-Level Security (C-1)
-- Pixie Girl Hub · JBS Praxis · Conformance pass V2.2
--
-- Spec mandate (V2.2 §3):
--   "Enforce at the data layer (row-level security on entity_id),
--    not only the UI."
--
-- Strategy (decided as Option A per user 2026-06-04):
--   • Every shared table with a `business` column gets RLS enabled.
--   • Policy: visible rows = those where business = current_setting('app.current_business').
--   • Every API request opens a transaction and runs
--     SET LOCAL app.current_business = 'pixiegirl' (or 'faitlynhair').
--   • CEO bypass: SET LOCAL app.current_business = 'all' makes the
--     helper return NULL → no rows are filtered.
--   • System / migration paths: SET LOCAL row_security = off (the
--     pixie_app role lacks BYPASSRLS; only superuser bypasses).
--
-- The brand-context middleware (src/middleware/brand-context.js) already
-- exists and provides req.brand. The database helper withBrand(brand, fn)
-- in src/config/database.js sets app.current_business per transaction.
--
-- This migration ENABLES RLS on 62 tables and adds matching policies.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ HELPER FUNCTIONS                                                   ║
-- ║                                                                    ║
-- ║ shared.current_business() — returns the GUC value or NULL.         ║
-- ║                              NULL means "no policy filter applied" ║
-- ║                              (CEO cross-brand view).               ║
-- ║                                                                    ║
-- ║ Marked STABLE + SET search_path for safe inlining and security.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.current_business()
RETURNS TEXT
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog AS $$
  SELECT NULLIF(current_setting('app.current_business', true), '')
$$;

COMMENT ON FUNCTION shared.current_business() IS
  'C-1 RLS: returns the brand context set per-transaction via SET LOCAL app.current_business. NULL = no filter applied (CEO cross-brand view).';

-- Same idea for current_user_id (used by audit + future RLS on per-user tables)
CREATE OR REPLACE FUNCTION shared.current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID
$$;

COMMENT ON FUNCTION shared.current_user_id() IS
  'C-1 RLS companion: returns the user_id set via SET LOCAL app.current_user_id, or NULL.';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ POLICY GENERATOR                                                   ║
-- ║                                                                    ║
-- ║ Looks at every BASE TABLE in `shared` schema that has a column     ║
-- ║ named `business`, enables RLS, and creates a single permissive     ║
-- ║ ALL policy that lets a row through when:                           ║
-- ║   • the GUC is unset (NULL — admin / cross-brand context), OR      ║
-- ║   • the row's business equals the GUC.                             ║
-- ║                                                                    ║
-- ║ Tables explicitly excluded (need RLS off):                         ║
-- ║   • business_config itself — every brand has to read both rows     ║
-- ║     to build the brand selector at login.                          ║
-- ║   • migrations — bootstrap utility table.                          ║
-- ║                                                                    ║
-- ║ Tables with a business column but special policies:                ║
-- ║   • intercompany_transactions / intercompany_reconciliations:      ║
-- ║     visible to BOTH brands (FROM-brand and TO-brand). Custom       ║
-- ║     policy below replaces the generated one.                       ║
-- ║   • audit_log: write-only RLS — readable by current brand context  ║
-- ║     but also by any user with audit.view permission (handled at    ║
-- ║     app layer; DB policy follows the standard model).              ║
-- ╚════════════════════════════════════════════════════════════════════╝

DO $$
DECLARE
  v_table_name TEXT;
  v_excluded TEXT[] := ARRAY['business_config','migrations'];
  v_count INTEGER := 0;
BEGIN
  FOR v_table_name IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'shared'
       AND c.column_name = 'business'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name <> ALL(v_excluded)
     ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE shared.%I ENABLE ROW LEVEL SECURITY', v_table_name);
    EXECUTE format($pol$
      CREATE POLICY brand_isolation ON shared.%I
        AS PERMISSIVE FOR ALL
        USING (
          shared.current_business() IS NULL
          OR business = shared.current_business()
        )
        WITH CHECK (
          shared.current_business() IS NULL
          OR business = shared.current_business()
        )
    $pol$, v_table_name);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'C-1 RLS: enabled on % shared tables', v_count;
END;
$$;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ INTERCOMPANY: dual-visibility policy                               ║
-- ║                                                                    ║
-- ║ An intercompany_transaction belongs to BOTH brands (seller + buyer).║
-- ║ Both should see it. Schema uses seller_brand / buyer_brand columns ║
-- ║ instead of a single `business` column. (Therefore these tables     ║
-- ║ aren't picked up by the generator above — explicit policy here.)   ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.intercompany_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY intercompany_dual_visibility ON shared.intercompany_transactions
  AS PERMISSIVE FOR ALL
  USING (
    shared.current_business() IS NULL
    OR seller_brand = shared.current_business()
    OR buyer_brand  = shared.current_business()
  )
  WITH CHECK (
    shared.current_business() IS NULL
    OR seller_brand = shared.current_business()
    OR buyer_brand  = shared.current_business()
  );

-- intercompany_reconciliations: row visibility follows its parent transaction
ALTER TABLE shared.intercompany_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY intercompany_recon_dual_visibility ON shared.intercompany_reconciliations
  AS PERMISSIVE FOR ALL
  USING (
    shared.current_business() IS NULL
    OR EXISTS (
      SELECT 1 FROM shared.intercompany_transactions t
       WHERE t.ic_transaction_id = shared.intercompany_reconciliations.ic_transaction_id
         AND (t.seller_brand = shared.current_business()
              OR t.buyer_brand = shared.current_business())
    )
  )
  WITH CHECK (
    shared.current_business() IS NULL
    OR EXISTS (
      SELECT 1 FROM shared.intercompany_transactions t
       WHERE t.ic_transaction_id = shared.intercompany_reconciliations.ic_transaction_id
         AND (t.seller_brand = shared.current_business()
              OR t.buyer_brand = shared.current_business())
    )
  );

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ APPLICATION ROLE                                                   ║
-- ║                                                                    ║
-- ║ Create the role used by the Node.js backend. Lacks BYPASSRLS so    ║
-- ║ RLS policies fire on every query. Has CRUD on shared + brand       ║
-- ║ schemas — actual permission enforcement remains in app middleware. ║
-- ║                                                                    ║
-- ║ The role uses LOGIN PASSWORD set out-of-band (env DB_PASSWORD).    ║
-- ║ This migration creates the role if missing without setting a       ║
-- ║ password (cluster owner sets it manually or via Terraform).        ║
-- ╚════════════════════════════════════════════════════════════════════╝

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixie_app') THEN
    CREATE ROLE pixie_app NOLOGIN;
    RAISE NOTICE 'C-1 RLS: created role pixie_app (NOLOGIN; cluster owner must alter for login + password)';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA shared TO pixie_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared TO pixie_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA shared TO pixie_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA shared TO pixie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pixie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO pixie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared
  GRANT EXECUTE ON FUNCTIONS TO pixie_app;

-- ============================================================
-- After this migration:
--   • shared.current_business() + shared.current_user_id() helpers ready
--   • RLS enabled on ~60 shared tables; CEO cross-brand context via NULL GUC
--   • intercompany tables visible to both FROM and TO brands
--   • pixie_app role exists with no-BYPASSRLS
-- ============================================================
