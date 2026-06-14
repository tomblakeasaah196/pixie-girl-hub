"use strict";

/**
 * Entity-isolation / RLS integration test (V2.2 §3 / BACKEND_COMPLETION_PLAN §1.4).
 *
 * Proves two things about the row-level-security on shared tables (migration
 * 000200):
 *   (1) RLS is actually ENABLED on every business-scoped shared table.
 *   (2) The policy + the `app.current_business` GUC correctly isolate rows for a
 *       NON-SUPERUSER role — i.e. with the brand set, only that brand's rows are
 *       visible; with no brand (CEO/cross-brand), both are.
 *
 * Why a separate low-privilege role: Postgres RLS is bypassed by superusers AND
 * by the table owner (unless FORCE). CI/dev usually connect as `postgres`
 * (superuser), so the app connection itself can't demonstrate isolation. This
 * test provisions a throwaway NOSUPERUSER role and connects as it — which is
 * exactly the posture the production app must run in (DB_USER = a non-superuser
 * app role such as pixie_app). See docs/ENTITY_ISOLATION.md.
 *
 * OPT-IN: RUN_DB_TESTS=1 with a migrated DB. Skipped otherwise.
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const { Client } = require("pg");
const db = require("../../src/config/database");
const { config } = require("../../src/config/env");

const suite = RUN ? describe : describe.skip;
const ROLE = "rls_selftest_role";
const TBL = "shared._rls_selftest";

suite("Entity isolation — RLS on shared tables (§3)", () => {
  beforeAll(async () => {
    await db.initDatabase();
  });

  afterAll(async () => {
    // Best-effort cleanup of anything the filtering test provisioned.
    for (const sql of [
      `DROP TABLE IF EXISTS ${TBL}`,
      `DROP OWNED BY ${ROLE}`,
      `DROP ROLE IF EXISTS ${ROLE}`,
    ]) {
      try {
        await db.query(sql);
      } catch {
        /* ignore */
      }
    }
    await db.closeDatabase();
  });

  test("RLS is enabled on every business-scoped shared table", async () => {
    const { rows } = await db.query(
      `SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS forced
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'shared' AND c.relkind = 'r'
          AND c.relname NOT IN ('business_config','migrations')
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema = 'shared'
               AND col.table_name = c.relname
               AND col.column_name = 'business')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const notEnabled = rows.filter((r) => !r.rls_enabled).map((r) => r.relname);
    expect(notEnabled).toEqual([]);
  });

  test("the brand GUC isolates rows for a non-superuser role", async () => {
    const who = await db.query(`SELECT current_setting('is_superuser') AS su`);
    if (who.rows[0].su !== "on") {
      // Can't provision a role without superuser/CREATEROLE. Fall back to
      // asserting the policy machinery exists; the real role-based proof needs
      // a privileged connection (CI runs as postgres).
      const pol = await db.query(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'shared'`,
      );
      expect(pol.rows[0].n).toBeGreaterThan(0);
      /// eslint-disable-next-line no-console
      console.warn(
        "entity-isolation: connection is not superuser; asserted policies exist but skipped the role-based filtering proof.",
      );
      return;
    }

    // 1) A synthetic shared table mirroring the real brand_isolation policy,
    //    FORCEd so even the owner is subject to it.
    await db.query(`DROP TABLE IF EXISTS ${TBL}`);
    await db.query(`CREATE TABLE ${TBL} (business text NOT NULL, secret text)`);
    await db.query(
      `INSERT INTO ${TBL} VALUES ('pixiegirl','pg-secret'),('faitlynhair','flh-secret')`,
    );
    await db.query(`ALTER TABLE ${TBL} ENABLE ROW LEVEL SECURITY`);
    await db.query(`ALTER TABLE ${TBL} FORCE ROW LEVEL SECURITY`);
    await db.query(
      `CREATE POLICY brand_isolation ON ${TBL}
         AS PERMISSIVE FOR ALL
         USING (shared.current_business() IS NULL OR business = shared.current_business())
         WITH CHECK (shared.current_business() IS NULL OR business = shared.current_business())`,
    );

    // 2) A throwaway NON-superuser role — the production app posture.
    await db.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await db.query(
      `CREATE ROLE ${ROLE} LOGIN PASSWORD 'selftest_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    await db.query(`GRANT USAGE ON SCHEMA shared TO ${ROLE}`);
    await db.query(`GRANT SELECT ON ${TBL} TO ${ROLE}`);
    await db.query(
      `GRANT EXECUTE ON FUNCTION shared.current_business() TO ${ROLE}`,
    );

    const client = new Client({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: ROLE,
      password: "selftest_pw",
    });
    await client.connect();
    try {
      // No brand context → CEO/cross-brand view → both rows visible.
      const all = await client.query(`SELECT business FROM ${TBL}`);
      expect(new Set(all.rows.map((r) => r.business)).size).toBe(2);

      // Brand context set → only that brand's row is visible.
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('app.current_business','faitlynhair',true)`,
      );
      const scoped = await client.query(`SELECT business, secret FROM ${TBL}`);
      await client.query("COMMIT");

      expect(scoped.rows).toHaveLength(1);
      expect(scoped.rows[0].business).toBe("faitlynhair");
      // The other brand's secret must be invisible.
      expect(scoped.rows.some((r) => r.secret === "pg-secret")).toBe(false);
    } finally {
      await client.end();
    }
  });
});
