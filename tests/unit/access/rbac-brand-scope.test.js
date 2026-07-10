/**
 * requirePermission — brand-scoped role grants.
 *
 * A role granted for one business must not confer permissions under another
 * brand context; '*' grants apply everywhere. Older cached auth projections
 * without role_grants fall back to the unscoped role set.
 */

"use strict";

jest.mock("../../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(),
}));

const identityCache = require("../../../src/shared/cache/identity-cache");
const { requirePermission } = require("../../../src/middleware/rbac");

const ROLE_FLH = "11111111-1111-1111-1111-111111111111";
const ROLE_STAR = "22222222-2222-2222-2222-222222222222";

function reqWith({ brand, role_ids, role_grants, is_ceo = false }) {
  return {
    brand,
    user: { user_id: "u-1", is_ceo, role_ids, role_grants },
  };
}

async function run(mw, req) {
  const next = jest.fn();
  await mw(req, {}, next);
  return next;
}

beforeEach(() => {
  identityCache.getGrants.mockReset();
  identityCache.getGrants.mockResolvedValue([{ record_scope: "all" }]);
});

describe("requirePermission brand scoping", () => {
  const mw = requirePermission("sales", "view");

  test("a grant scoped to the active brand is used", async () => {
    const req = reqWith({
      brand: "faitlynhair",
      role_ids: [ROLE_FLH],
      role_grants: [{ role_id: ROLE_FLH, business: "faitlynhair" }],
    });
    const next = await run(mw, req);
    expect(identityCache.getGrants).toHaveBeenCalledWith(
      expect.objectContaining({ role_ids: [ROLE_FLH] }),
    );
    expect(next).toHaveBeenCalled();
    expect(req.permission_scope).toBe("all");
  });

  test("a grant scoped to ANOTHER brand is excluded under this one", async () => {
    identityCache.getGrants.mockResolvedValue([]);
    const req = reqWith({
      brand: "pixiegirl",
      role_ids: [ROLE_FLH],
      role_grants: [{ role_id: ROLE_FLH, business: "faitlynhair" }],
    });
    await expect(run(mw, req)).rejects.toThrow("No permission");
    expect(identityCache.getGrants).toHaveBeenCalledWith(
      expect.objectContaining({ role_ids: [] }),
    );
  });

  test("'*' grants apply under every brand", async () => {
    const req = reqWith({
      brand: "pixiegirl",
      role_ids: [ROLE_STAR],
      role_grants: [{ role_id: ROLE_STAR, business: "*" }],
    });
    const next = await run(mw, req);
    expect(identityCache.getGrants).toHaveBeenCalledWith(
      expect.objectContaining({ role_ids: [ROLE_STAR] }),
    );
    expect(next).toHaveBeenCalled();
  });

  test("falls back to unscoped role_ids when role_grants is absent (stale cache)", async () => {
    const req = reqWith({
      brand: "pixiegirl",
      role_ids: [ROLE_FLH, ROLE_STAR],
      role_grants: null,
    });
    await run(mw, req);
    expect(identityCache.getGrants).toHaveBeenCalledWith(
      expect.objectContaining({ role_ids: [ROLE_FLH, ROLE_STAR] }),
    );
  });

  test("CEO bypasses without consulting grants", async () => {
    const req = reqWith({ brand: "pixiegirl", role_ids: [], is_ceo: true });
    const next = await run(mw, req);
    expect(identityCache.getGrants).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(req.permission_scope).toBe("all");
  });
});
