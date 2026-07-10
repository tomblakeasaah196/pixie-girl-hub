"use strict";

/**
 * authMiddleware idle-session enforcement. A valid, unexpired access JWT is
 * NOT enough: the session's redis idle marker must still be alive, and only
 * requests carrying X-User-Activity re-arm it. This is what makes a
 * walked-away session stop working everywhere at once instead of riding out
 * the access token's remaining minutes.
 */

const SECRET = "test-secret-test-secret-test-secret!";

jest.mock("../../../src/config/env", () => ({
  config: {
    JWT_SECRET: "test-secret-test-secret-test-secret!",
    SESSION_IDLE_TIMEOUT_S: 2700,
  },
  validateEnv: () => {},
}));

const mockRedis = { expire: jest.fn(), exists: jest.fn() };
jest.mock("../../../src/config/redis", () => ({ getClient: () => mockRedis }));

const mockIdentityCache = { getAuthUser: jest.fn() };
jest.mock("../../../src/shared/cache/identity-cache", () => mockIdentityCache);

const jwt = require("jsonwebtoken");
const { authMiddleware } = require("../../../src/middleware/auth");

beforeEach(() => {
  jest.clearAllMocks();
  mockIdentityCache.getAuthUser.mockResolvedValue({
    user_id: "u1",
    email: "x@y.com",
    status: "active",
    role_ids: [],
    is_ceo: false,
    available_businesses: ["pixiegirl"],
  });
});

function makeReq({ sid = "sid-1", activity } = {}) {
  const claims = { sub: "u1", jti: "a1" };
  if (sid) claims.sid = sid;
  const token = jwt.sign(claims, SECRET, { expiresIn: "45m" });
  const headers = { authorization: `Bearer ${token}` };
  if (activity) headers["x-user-activity"] = "1";
  return { headers };
}

test("request with user activity re-arms the idle window and passes", async () => {
  mockRedis.expire.mockResolvedValue(1);
  const req = makeReq({ activity: true });
  const next = jest.fn();

  await authMiddleware(req, {}, next);

  expect(mockRedis.expire).toHaveBeenCalledWith("session:idle:sid-1", 2700);
  expect(mockRedis.exists).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
  expect(req.user.user_id).toBe("u1");
});

test("background request only checks the window — never re-arms it", async () => {
  mockRedis.exists.mockResolvedValue(1);
  const next = jest.fn();

  await authMiddleware(makeReq(), {}, next);

  expect(mockRedis.exists).toHaveBeenCalledWith("session:idle:sid-1");
  expect(mockRedis.expire).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});

test("lapsed idle marker rejects even a still-valid access token", async () => {
  mockRedis.exists.mockResolvedValue(0);

  await expect(authMiddleware(makeReq(), {}, jest.fn())).rejects.toMatchObject({
    code: "SESSION_IDLE_TIMEOUT",
    http_status: 401,
  });
});

test("a dead session cannot be revived by touching it (EXPIRE on missing key = 0)", async () => {
  mockRedis.expire.mockResolvedValue(0);

  await expect(
    authMiddleware(makeReq({ activity: true }), {}, jest.fn()),
  ).rejects.toMatchObject({ code: "SESSION_IDLE_TIMEOUT", http_status: 401 });
});

test("access token without a sid (pre-enforcement) is rejected", async () => {
  await expect(
    authMiddleware(makeReq({ sid: null }), {}, jest.fn()),
  ).rejects.toMatchObject({ code: "SESSION_IDLE_TIMEOUT", http_status: 401 });
  expect(mockRedis.exists).not.toHaveBeenCalled();
  expect(mockRedis.expire).not.toHaveBeenCalled();
});
