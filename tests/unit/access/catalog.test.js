"use strict";

/**
 * RBAC vocabulary unit tests (V2.2 §3). access.catalog is the single source of
 * truth for what module/action/scope a permission row may reference; the seed
 * migration and the requirePermission middleware must agree with it. Pure, no DB.
 */

const {
  MODULES,
  ACTIONS,
  RECORD_SCOPES,
  isValidModule,
  isValidAction,
  isValidScope,
  catalog,
} = require("../../../src/shared/access/access.catalog");

describe("permission catalog", () => {
  test("enumerates the enforced module keys without duplicates", () => {
    expect(new Set(MODULES).size).toBe(MODULES.length);
    // The matrix seed (000207) grants against exactly these keys.
    [
      "accounting",
      "crm",
      "sales",
      "stock",
      "hr_payroll",
      "settings",
      "intercompany",
    ].forEach((k) => expect(MODULES).toContain(k));
    expect(MODULES.length).toBeGreaterThanOrEqual(37);
  });

  test("action vocabulary matches the middleware and the permissions schema", () => {
    expect(ACTIONS).toEqual([
      "view",
      "create",
      "edit",
      "delete",
      "approve",
      "export",
    ]);
    expect(RECORD_SCOPES).toEqual(["all", "own", "team"]);
  });

  test("validators accept catalog members and reject strangers", () => {
    expect(isValidModule("accounting")).toBe(true);
    expect(isValidModule("not_a_module")).toBe(false);
    expect(isValidAction("approve")).toBe(true);
    expect(isValidAction("nuke")).toBe(false);
    expect(isValidScope("team")).toBe(true);
    expect(isValidScope("global")).toBe(false);
  });

  test("catalog() returns the grid the matrix UI renders", () => {
    const c = catalog();
    expect(c.actions).toEqual(ACTIONS);
    expect(c.record_scopes).toEqual(RECORD_SCOPES);
    expect(c.modules).toHaveLength(MODULES.length);
    expect(c.modules[0]).toHaveProperty("module");
    expect(c.modules[0]).toHaveProperty("actions");
  });
});
