"use strict";

/**
 * Identity cache (shared/cache/identity-cache.js) — read-through behaviour,
 * projection safety, event-driven invalidation, and the fail-open path.
 * Redis is faked with an in-memory Map; the repos are jest mocks.
 */

// In-memory fake of the ioredis surface the cache uses.
function makeFakeRedis() {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => {
      store.set(k, v);
      return "OK";
    }),
    del: jest.fn(async (...keys) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    scan: jest.fn(async (_cursor, _m, pattern, _c, _count) => {
      const re = new RegExp(
        "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      return ["0", [...store.keys()].filter((k) => re.test(k))];
    }),
  };
}

const mockRedis = makeFakeRedis();
jest.mock("../../../src/config/redis", () => ({
  getClient: jest.fn(() => mockRedis),
}));

// The lazy env proxy validates the full schema on first access — mock it with
// just the key the cache reads (same pattern as the other unit suites).
jest.mock("../../../src/config/env", () => ({
  config: { IDENTITY_CACHE_TTL_S: 30 },
}));

const mockFindById = jest.fn();
jest.mock("../../../src/shared/hr_payroll/staff.repo", () => ({
  findById: (...a) => mockFindById(...a),
}));

const mockFindGrants = jest.fn();
jest.mock("../../../src/shared/org_workflow/permissions.repo", () => ({
  findGrants: (...a) => mockFindGrants(...a),
}));

const mockFindByKey = jest.fn();
jest.mock("../../../src/modules/business_setup/business-config.repo", () => ({
  findByKey: (...a) => mockFindByKey(...a),
}));

const iamEvents = require("../../../src/shared/iam/iam.events");
const accessEvents = require("../../../src/shared/access/access.events");
const businessSetupEvents = require("../../../src/modules/business_setup/business-setup.events");
const cache = require("../../../src/shared/cache/identity-cache");

const USER_ROW = {
  user_id: "u-1",
  email: "a@b.c",
  display_name: "Ada",
  password_hash: "SECRET_HASH",
  pin_hash: "SECRET_PIN",
  status: "active",
  is_ceo: false,
  default_business_key: "pixiegirl",
  failed_login_count: 0,
  role_ids: ["r-1"],
  available_businesses: ["pixiegirl"],
};

// Event emission is fire-and-forget; the DEL happens async. Flush microtasks.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockRedis.store.clear();
  jest.clearAllMocks();
});

describe("getAuthUser", () => {
  it("loads from the repo once, then serves from cache", async () => {
    mockFindById.mockResolvedValue(USER_ROW);
    const first = await cache.getAuthUser("u-1");
    const second = await cache.getAuthUser("u-1");
    expect(mockFindById).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first.user_id).toBe("u-1");
    expect(first.status).toBe("active");
    expect(first.default_business_key).toBe("pixiegirl");
  });

  it("never caches credential hashes", async () => {
    mockFindById.mockResolvedValue(USER_ROW);
    const user = await cache.getAuthUser("u-1");
    expect(user.password_hash).toBeUndefined();
    expect(user.pin_hash).toBeUndefined();
    const raw = [...mockRedis.store.values()].join("|");
    expect(raw).not.toContain("SECRET_HASH");
    expect(raw).not.toContain("SECRET_PIN");
  });

  it("negative-caches a missing user", async () => {
    mockFindById.mockResolvedValue(null);
    expect(await cache.getAuthUser("gone")).toBeNull();
    expect(await cache.getAuthUser("gone")).toBeNull();
    expect(mockFindById).toHaveBeenCalledTimes(1);
  });

  it.each(["user_deactivated", "session_revoked", "password_reset"])(
    "invalidates on iam %s",
    async (evt) => {
      mockFindById.mockResolvedValue(USER_ROW);
      await cache.getAuthUser("u-1");
      iamEvents.emit(evt, { business: "pixiegirl", user_id: "u-1" });
      await flush();
      await cache.getAuthUser("u-1");
      expect(mockFindById).toHaveBeenCalledTimes(2);
    },
  );

  it("invalidates on access role_granted / role_revoked / user_access_changed", async () => {
    mockFindById.mockResolvedValue(USER_ROW);
    for (const evt of ["role_granted", "role_revoked", "user_access_changed"]) {
      await cache.getAuthUser("u-1");
      accessEvents.emit(evt, { brand: "pixiegirl", user_id: "u-1" });
      await flush();
    }
    await cache.getAuthUser("u-1");
    // 1 initial + 1 reload per event above = 4
    expect(mockFindById).toHaveBeenCalledTimes(4);
  });

  it("fails open to the repo when redis errors", async () => {
    mockFindById.mockResolvedValue(USER_ROW);
    mockRedis.get.mockRejectedValueOnce(new Error("redis down"));
    const user = await cache.getAuthUser("u-1");
    expect(user.user_id).toBe("u-1");
    expect(mockFindById).toHaveBeenCalledTimes(1);
  });
});

describe("getGrants", () => {
  const GRANT = [{ role_id: "r-1", module: "sales", action: "view", record_scope: "all" }];

  it("caches per sorted role-set × module × action", async () => {
    mockFindGrants.mockResolvedValue(GRANT);
    await cache.getGrants({ role_ids: ["r-2", "r-1"], module: "sales", action: "view" });
    await cache.getGrants({ role_ids: ["r-1", "r-2"], module: "sales", action: "view" });
    expect(mockFindGrants).toHaveBeenCalledTimes(1); // order-insensitive key
  });

  it("returns [] for an empty role set without touching cache or repo", async () => {
    expect(await cache.getGrants({ role_ids: [], module: "sales", action: "view" })).toEqual([]);
    expect(mockFindGrants).not.toHaveBeenCalled();
  });

  it("permissions_changed flushes every grants entry", async () => {
    mockFindGrants.mockResolvedValue(GRANT);
    await cache.getGrants({ role_ids: ["r-1"], module: "sales", action: "view" });
    await cache.getGrants({ role_ids: ["r-1"], module: "stock", action: "edit" });
    accessEvents.emit("permissions_changed", { brand: "pixiegirl", role_id: "r-1" });
    await flush();
    await cache.getGrants({ role_ids: ["r-1"], module: "sales", action: "view" });
    await cache.getGrants({ role_ids: ["r-1"], module: "stock", action: "edit" });
    expect(mockFindGrants).toHaveBeenCalledTimes(4);
  });
});

describe("getBrandConfig", () => {
  const CFG = { config_id: "c-1", business_key: "pixiegirl", vat_rate: "7.50" };

  it("caches and invalidates on business-setup config.updated", async () => {
    mockFindByKey.mockResolvedValue(CFG);
    await cache.getBrandConfig("pixiegirl");
    await cache.getBrandConfig("pixiegirl");
    expect(mockFindByKey).toHaveBeenCalledTimes(1);

    businessSetupEvents.emit("config.updated", { brand: "pixiegirl" });
    await flush();
    const cfg = await cache.getBrandConfig("pixiegirl");
    expect(cfg).toEqual(CFG);
    expect(mockFindByKey).toHaveBeenCalledTimes(2);
  });

  it("does not cross-invalidate other brands", async () => {
    mockFindByKey.mockResolvedValue(CFG);
    await cache.getBrandConfig("pixiegirl");
    businessSetupEvents.emit("config.updated", { brand: "faitlynhair" });
    await flush();
    await cache.getBrandConfig("pixiegirl");
    expect(mockFindByKey).toHaveBeenCalledTimes(1);
  });
});
