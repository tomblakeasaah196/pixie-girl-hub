/**
 * Unit tests for the Access module's pure logic: the permission catalog and
 * the escalation guards. No DB.
 */

"use strict";

const catalog = require("../../../src/shared/access/access.catalog");
const guards = require("../../../src/shared/access/access.guards");
const { grantMembersSchema } = require("../../../src/shared/access/access.validator");
const {
  PermissionDeniedError,
  ConflictError,
} = require("../../../src/utils/errors");

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

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
  test("the owner role can never be deleted; any other role can", () => {
    // Foundational: the owner role underpins the CEO bypass — never deletable.
    expect(() => guards.assertCanDeleteRole(owner, ownerRole)).toThrow(
      ConflictError,
    );
    expect(() => guards.assertCanDeleteRole(admin, ownerRole)).toThrow(
      ConflictError,
    );
    // Per owner directive, a settings admin may delete seeded system roles and
    // custom roles alike (the route enforces settings:delete).
    expect(() => guards.assertCanDeleteRole(admin, systemRole)).not.toThrow();
    expect(() => guards.assertCanDeleteRole(admin, customRole)).not.toThrow();
  });

  test("editing role definition / permissions is not owner-locked", () => {
    // Governed by settings:edit at the route — no extra system-role lock.
    expect(() => guards.assertCanMutateRole(admin, systemRole)).not.toThrow();
    expect(() => guards.assertCanMutateRole(owner, systemRole)).not.toThrow();
    expect(() =>
      guards.assertCanEditPermissions(admin, systemRole),
    ).not.toThrow();
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

describe("bulk role-members grant schema", () => {
  test("accepts a list of user UUIDs with a business", () => {
    const parsed = grantMembersSchema.parse({
      user_ids: [UUID_A, UUID_B],
      business: "pixiegirl",
    });
    expect(parsed.user_ids).toEqual([UUID_A, UUID_B]);
    expect(parsed.business).toBe("pixiegirl");
  });

  test("rejects an empty user list and non-UUID members", () => {
    expect(() =>
      grantMembersSchema.parse({ user_ids: [], business: "pixiegirl" }),
    ).toThrow();
    expect(() =>
      grantMembersSchema.parse({ user_ids: ["not-a-uuid"], business: "flh" }),
    ).toThrow();
  });

  test("requires a business key", () => {
    expect(() => grantMembersSchema.parse({ user_ids: [UUID_A] })).toThrow();
  });
});
