/**
 * approveGatedScope — read visibility for finance queues (expenses §6.7,
 * cash requests §6.32).
 *
 * The rule: only a caller who can `approve` the module (or the CEO) sees the
 * whole brand's queue ('all'); everyone else — including holders of a 'team'
 * or even 'all' *view* grant — is clamped to their OWN records ('own'). This
 * runs AFTER requirePermission(module, 'view'), overriding the scope it set.
 */

"use strict";

jest.mock("../../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(),
}));

const identityCache = require("../../../src/shared/cache/identity-cache");
const { approveGatedScope } = require("../../../src/middleware/rbac");

const ROLE = "22222222-2222-2222-2222-000000000002";

function reqWith({ is_ceo = false, role_ids = [ROLE], preset } = {}) {
  return {
    brand: "pixiegirl",
    // requirePermission would have set this from the view grant; the gate
    // must override it either way.
    permission_scope: preset ?? "all",
    user: {
      user_id: "u-1",
      is_ceo,
      role_ids,
      role_grants: [{ role_id: ROLE, business: "*" }],
    },
  };
}

async function run(mw, req) {
  const next = jest.fn();
  await mw(req, {}, next);
  return next;
}

beforeEach(() => {
  identityCache.getGrants.mockReset();
});

describe("approveGatedScope", () => {
  const mw = approveGatedScope("expenses");

  test("holder of an approve grant sees the whole queue ('all')", async () => {
    identityCache.getGrants.mockResolvedValue([{ record_scope: "all" }]);
    const req = reqWith({ preset: "team" });
    const next = await run(mw, req);
    expect(identityCache.getGrants).toHaveBeenCalledWith(
      expect.objectContaining({ module: "expenses", action: "approve" }),
    );
    expect(next).toHaveBeenCalled();
    expect(req.permission_scope).toBe("all");
  });

  test("view-only caller (no approve grant) is clamped to 'own'", async () => {
    identityCache.getGrants.mockResolvedValue([]);
    // Even though requirePermission resolved 'all' from a (mis-seeded) view
    // grant, the gate downgrades a non-approver to their own records.
    const req = reqWith({ preset: "all" });
    const next = await run(mw, req);
    expect(next).toHaveBeenCalled();
    expect(req.permission_scope).toBe("own");
  });

  test("'team' view scope no longer leaks the whole brand", async () => {
    identityCache.getGrants.mockResolvedValue([]);
    const req = reqWith({ preset: "team" });
    await run(mw, req);
    expect(req.permission_scope).toBe("own");
  });

  test("CEO sees everything without consulting grants", async () => {
    const req = reqWith({ is_ceo: true, preset: "own" });
    const next = await run(mw, req);
    expect(identityCache.getGrants).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(req.permission_scope).toBe("all");
  });

  test("unauthenticated request is rejected", async () => {
    const next = jest.fn();
    await expect(mw({ user: null }, {}, next)).rejects.toThrow(
      "Authentication required",
    );
    expect(next).not.toHaveBeenCalled();
  });
});
