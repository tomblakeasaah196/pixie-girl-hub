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
  CONTACT_TYPE_KEYS,
  isValidModule,
  isValidAction,
  isValidScope,
  isValidContactType,
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
      // Reconciled in — these are enforced by routes and were missing before.
      "catalogue",
      "help_center",
      "messaging_accounts",
      "service_catalogue",
    ].forEach((k) => expect(MODULES).toContain(k));
    expect(MODULES.length).toBeGreaterThanOrEqual(37);
  });

  test("does not carry retired modules that nothing enforces", () => {
    // POS was retired (owner directive) — selling happens through Sales.
    // A key here that no route enforces lets the matrix accumulate dead grants.
    expect(MODULES).not.toContain("pos");
    // E-Commerce (storefront admin) and Intercompany were retired (out of scope
    // for single-business tenants). The public storefront still runs, but the
    // admin permission keys are gone from the matrix. See migration 000344.
    expect(MODULES).not.toContain("storefront");
    expect(MODULES).not.toContain("intercompany");
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

  // Contact-type visibility vocabulary (contacts §6.12). Must stay in step with
  // shared.contacts.contact_type[] and the role_contact_type_access CHECK.
  test("contact-type vocabulary matches the schema's contact_type set", () => {
    expect(CONTACT_TYPE_KEYS).toEqual([
      "customer",
      "supplier",
      "staff",
      "retail_partner",
      "stylist_partner",
    ]);
    expect(isValidContactType("supplier")).toBe(true);
    expect(isValidContactType("vendor")).toBe(false);
  });

  test("catalog() exposes contact_types for the role editor", () => {
    const c = catalog();
    expect(c.contact_types).toHaveLength(CONTACT_TYPE_KEYS.length);
    expect(c.contact_types[0]).toHaveProperty("key");
    expect(c.contact_types[0]).toHaveProperty("label");
  });
});
