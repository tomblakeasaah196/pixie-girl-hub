"use strict";

/**
 * Dashboards access guard (§6.20 — management-circle entry).
 *
 * Matrix path via the cached grants lookup, org-chart fallback (management
 * position / dotted-line can_view_dashboards) for VIEW only, CEO bypass,
 * export stays matrix-only. DB + identity cache mocked — no database.
 */

process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "test";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";
process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(40);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "y".repeat(40);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "z".repeat(64);

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(),
}));

const { query } = require("../../../src/config/database");
const identityCache = require("../../../src/shared/cache/identity-cache");
const access = require("../../../src/modules/dashboards/dashboards.access");
const { PermissionDeniedError } = require("../../../src/utils/errors");

const ceo = { user_id: "u-ceo", role_ids: [], is_ceo: true };
const manager = { user_id: "u-mgr", role_ids: ["r-mgr"], is_ceo: false };

function run(mw, req = {}) {
  return new Promise((resolve, reject) => {
    Promise.resolve(mw(req, {}, (err) => (err ? reject(err) : resolve(req))))
      .catch(reject);
  });
}

beforeEach(() => {
  query.mockReset();
  identityCache.getGrants.mockReset();
});

describe("requireDashboardView", () => {
  test("CEO bypasses without any lookups", async () => {
    const req = { user: ceo };
    await run(access.requireDashboardView, req);
    expect(req.dashboard_access).toEqual({ via: "ceo" });
    expect(identityCache.getGrants).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test("matrix grant admits without touching org chart", async () => {
    identityCache.getGrants.mockResolvedValue([{ record_scope: "team" }]);
    const req = { user: manager };
    await run(access.requireDashboardView, req);
    expect(req.dashboard_access).toEqual({ via: "matrix" });
    expect(query).not.toHaveBeenCalled();
  });

  test("org-chart rights admit when the matrix says no", async () => {
    identityCache.getGrants.mockResolvedValue([]);
    query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const req = { user: manager };
    await run(access.requireDashboardView, req);
    expect(req.dashboard_access).toEqual({ via: "org" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([manager.user_id]);
  });

  test("denies when neither matrix nor org chart grants", async () => {
    identityCache.getGrants.mockResolvedValue([]);
    query.mockResolvedValue({ rows: [] });
    await expect(
      run(access.requireDashboardView, { user: manager }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("requireDashboardExport", () => {
  test("org rights never grant export", async () => {
    identityCache.getGrants.mockResolvedValue([]);
    // Even with an org grant available, export must not consult it.
    query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    await expect(
      run(access.requireDashboardExport, { user: manager }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(query).not.toHaveBeenCalled();
  });

  test("matrix export grant admits; CEO bypasses", async () => {
    identityCache.getGrants.mockResolvedValue([{ record_scope: "all" }]);
    await run(access.requireDashboardExport, { user: manager });
    await run(access.requireDashboardExport, { user: ceo });
  });
});

describe("capabilities", () => {
  test("maps module grants to tab/tile gates", async () => {
    identityCache.getGrants.mockImplementation(async ({ module, action }) => {
      if (module === "dashboards" && action === "view")
        return [{ record_scope: "team" }];
      if (module === "hr_payroll" && action === "view")
        return [{ record_scope: "team" }];
      return [];
    });
    const caps = await access.capabilities(manager);
    expect(caps).toEqual({
      can_export: false,
      can_finance: false,
      can_hr: true,
      can_cost: false,
      all_entities: false,
    });
  });

  test("CEO gets everything including the all-entities view", async () => {
    const caps = await access.capabilities(ceo);
    expect(caps.can_finance).toBe(true);
    expect(caps.can_hr).toBe(true);
    expect(caps.can_cost).toBe(true);
    expect(caps.all_entities).toBe(true);
  });
});
