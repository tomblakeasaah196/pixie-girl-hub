/**
 * Unit tests for the Access module's pure logic: the permission catalog and
 * the escalation guards. No DB.
 */

"use strict";

const catalog = require("../../../src/shared/access/access.catalog");
const guards = require("../../../src/shared/access/access.guards");
const {
  PermissionDeniedError,
  ConflictError,
} = require("../../../src/utils/errors");

const owner = { user_id: "u-owner", is_ceo: true };
const admin = { user_id: "u-admin", is_ceo: false };
const ownerRole = { role_id: guards.OWNER_ROLE_ID, is_system: true };
const systemRole = { role_id: "sys-1", is_system: true };
const customRole = { role_id: "cus-1", is_system: false };

describe("catalog", () => {
  test("enforced module keys are present, abbreviations are not", () => {
    expect(catalog.isValidModule("org_workflow")).toBe(true);
    expect(catalog.isValidModule("sales_campaigns")).toBe(true);
    expect(catalog.isValidModule("hr_payroll")).toBe(true);
    expect(catalog.isValidModule("settings")).toBe(true);
    // The schema-comment abbreviations are NOT the enforced keys:
    expect(catalog.isValidModule("workflow")).toBe(false);
    expect(catalog.isValidModule("campaigns")).toBe(false);
    expect(catalog.isValidModule("staff")).toBe(false);
  });

  test("actions and scopes", () => {
    ["view", "create", "edit", "delete", "approve", "export"].forEach((a) =>
      expect(catalog.isValidAction(a)).toBe(true),
    );
    expect(catalog.isValidAction("nuke")).toBe(false);
    expect(catalog.isValidScope("team")).toBe(true);
    expect(catalog.isValidScope("global")).toBe(false);
  });

  test("catalog() grid shape", () => {
    const grid = catalog.catalog();
    expect(grid.modules.length).toBe(catalog.MODULES.length);
    expect(grid.modules[0]).toHaveProperty("actions");
    expect(grid.record_scopes).toEqual(["all", "own", "team"]);
  });
});

describe("escalation guards", () => {
  test("system roles cannot be deleted by anyone", () => {
    expect(() => guards.assertCanDeleteRole(owner, systemRole)).toThrow(
      ConflictError,
    );
    expect(() => guards.assertCanDeleteRole(admin, systemRole)).toThrow(
      ConflictError,
    );
    expect(() => guards.assertCanDeleteRole(admin, customRole)).not.toThrow();
  });

  test("only owner may mutate / repermission system roles", () => {
    expect(() => guards.assertCanMutateRole(admin, systemRole)).toThrow(
      PermissionDeniedError,
    );
    expect(() => guards.assertCanMutateRole(owner, systemRole)).not.toThrow();
    expect(() => guards.assertCanEditPermissions(admin, systemRole)).toThrow(
      PermissionDeniedError,
    );
    expect(() =>
      guards.assertCanEditPermissions(admin, customRole),
    ).not.toThrow();
  });

  test("only owner may grant or revoke the owner role", () => {
    expect(() => guards.assertCanGrantRole(admin, ownerRole)).toThrow(
      PermissionDeniedError,
    );
    expect(() => guards.assertCanRevokeRole(admin, ownerRole)).toThrow(
      PermissionDeniedError,
    );
    expect(() => guards.assertCanGrantRole(owner, ownerRole)).not.toThrow();
    // A delegated admin can still grant ordinary roles.
    expect(() => guards.assertCanGrantRole(admin, customRole)).not.toThrow();
  });
});
