"use strict";

/**
 * Access-matrix integration test (V2.2 §3 / BACKEND_COMPLETION_PLAN §1.3).
 *
 * Proves the seed migration 000207 encoded the spec's Role × Module matrix and
 * that the spec's privacy rules hold — e.g. "cost & pay are private": a Sales
 * Rep has no grant on Accounting or HR/Payroll; Operations cannot see
 * Accounting; Business Setup is CEO-only. Reads shared.permissions/roles
 * directly (the same table requirePermission consults).
 *
 * OPT-IN (needs a migrated DB): RUN_DB_TESTS=1. Skipped otherwise.
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const db = require("../../src/config/database");

const NAMED = [
  "hr_admin",
  "ops_mgr",
  "sales_rep",
  "tech_stylist",
  "mktg_partner",
  "security",
  "china_prod",
  "finance",
];

const suite = RUN ? describe : describe.skip;

suite("Access Matrix (§3) is seeded and enforces the spec", () => {
  beforeAll(async () => {
    await db.initDatabase();
  });
  afterAll(async () => {
    await db.closeDatabase();
  });

  /** action rows a role holds on a module (empty = denied). */
  async function grants(role, module, action) {
    const params = [role, module];
    let sql = `SELECT p.action, p.record_scope
                 FROM shared.permissions p
                 JOIN shared.roles r ON r.role_id = p.role_id
                WHERE r.role_name = $1 AND p.module = $2`;
    if (action) {
      sql += ` AND p.action = $3`;
      params.push(action);
    }
    const { rows } = await db.query(sql, params);
    return rows;
  }

  test("the named operational roles exist", async () => {
    const { rows } = await db.query(
      `SELECT role_name FROM shared.roles WHERE role_name = ANY($1)`,
      [NAMED],
    );
    expect(rows.map((r) => r.role_name).sort()).toEqual([...NAMED].sort());
  });

  test("cost & pay are private — Sales Rep cannot touch Accounting or Payroll", async () => {
    expect(await grants("sales_rep", "accounting")).toHaveLength(0);
    expect(await grants("sales_rep", "hr_payroll")).toHaveLength(0);
  });

  test("Operations Manager has no Accounting access (spec matrix)", async () => {
    expect(await grants("ops_mgr", "accounting")).toHaveLength(0);
  });

  test("Business Setup is CEO-only (no named operational role holds it)", async () => {
    const { rows } = await db.query(
      `SELECT DISTINCT r.role_name
         FROM shared.permissions p JOIN shared.roles r ON r.role_id = p.role_id
        WHERE p.module = 'business_setup' AND r.role_name = ANY($1)`,
      [NAMED],
    );
    expect(rows).toEqual([]);
  });

  test("Finance (future seat) gets full Accounting, including approve", async () => {
    const rows = await grants("finance", "accounting");
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual([
      "approve",
      "create",
      "delete",
      "edit",
      "export",
      "view",
    ]);
    expect(rows.every((r) => r.record_scope === "all")).toBe(true);
  });

  test("Sales Rep submits but does not approve (own-scoped)", async () => {
    expect(await grants("sales_rep", "sales", "create")).toHaveLength(1); // sells
    expect(await grants("sales_rep", "expenses", "approve")).toHaveLength(0); // can't approve
    const crm = await grants("sales_rep", "crm", "view");
    expect(crm[0].record_scope).toBe("own"); // only their own customers
  });

  test("China Production has no Attendance grant (spec matrix)", async () => {
    expect(await grants("china_prod", "attendance")).toHaveLength(0);
  });
});
