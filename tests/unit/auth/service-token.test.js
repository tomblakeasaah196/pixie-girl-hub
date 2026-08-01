"use strict";

/**
 * cos_plan_exec service-token path through authMiddleware. The token lets the
 * BullMQ plan-execution worker act as the confirming user WITHOUT a live
 * session (no sid, no idle-marker check) — but only on the CoS workspace
 * routes. Anywhere else it must be rejected outright, so a leaked token
 * cannot touch sales/cash/HR.
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
const {
  mintCosPlanExecToken,
  COS_PLAN_EXEC_TYP,
} = require("../../../src/shared/hr_payroll/service-tokens");

beforeEach(() => {
  jest.clearAllMocks();
  mockIdentityCache.getAuthUser.mockResolvedValue({
    user_id: "ceo-1",
    email: "ceo@pixiegirl.com",
    status: "active",
    role_ids: [],
    is_ceo: true,
    available_businesses: ["pixiegirl", "faitlynhair"],
  });
});

function makeServiceReq({ token, url = "/api/v1/goals/g-1" } = {}) {
  const t =
    token ??
    mintCosPlanExecToken({ user_id: "ceo-1", plan_id: "plan-1", brand: "pixiegirl" });
  return { headers: { authorization: `Bearer ${t}` }, originalUrl: url };
}

test("mint: token carries typ / plan_id / brand and the user as sub", () => {
  const token = mintCosPlanExecToken({
    user_id: "ceo-1",
    plan_id: "plan-1",
    brand: "pixiegirl",
  });
  const payload = jwt.verify(token, SECRET);
  expect(payload.typ).toBe(COS_PLAN_EXEC_TYP);
  expect(payload.sub).toBe("ceo-1");
  expect(payload.plan_id).toBe("plan-1");
  expect(payload.brand).toBe("pixiegirl");
  // 2h TTL, ± a minute of clock slop.
  expect(payload.exp - payload.iat).toBe(2 * 60 * 60);
});

test("accepted on a workspace route WITHOUT any idle-session check", async () => {
  const req = makeServiceReq();
  const next = jest.fn();

  await authMiddleware(req, {}, next);

  expect(next).toHaveBeenCalled();
  // The whole point: no sid → the redis idle marker must never be consulted.
  expect(mockRedis.exists).not.toHaveBeenCalled();
  expect(mockRedis.expire).not.toHaveBeenCalled();
  // Resolves to the REAL user (RBAC unchanged), tagged as service traffic.
  expect(req.user.user_id).toBe("ceo-1");
  expect(req.user.is_ceo).toBe(true);
  expect(req.user.is_service).toBe(true);
  expect(req.user.service_plan_id).toBe("plan-1");
});

test.each([
  "/api/v1/goals",
  "/api/v1/goals/g-1/milestones/m-1",
  "/api/v1/tasks/t-9/status",
  "/api/v1/calendar/e-3",
  "/api/v1/notes",
  "/api/v1/contacts?query=jane", // query string must not defeat the check
])("accepted on workspace route %s", async (url) => {
  const next = jest.fn();
  await authMiddleware(makeServiceReq({ url }), {}, next);
  expect(next).toHaveBeenCalled();
});

test.each([
  "/api/v1/sales/orders",
  "/api/v1/accounting/journals",
  "/api/v1/hr/payroll-runs",
  "/api/v1/auth/refresh",
  "/api/v1/goalsxyz", // prefix boundary: 'goals' must not match 'goalsxyz'
  "/api/v1/tasksomething",
])("rejected with 403 on non-workspace route %s", async (url) => {
  await expect(
    authMiddleware(makeServiceReq({ url }), {}, jest.fn()),
  ).rejects.toMatchObject({ code: "SERVICE_TOKEN_SCOPE", http_status: 403 });
  // Rejected before any user load — the identity cache is never touched.
  expect(mockIdentityCache.getAuthUser).not.toHaveBeenCalled();
});

test("expired service token is rejected as TOKEN_EXPIRED", async () => {
  const token = jwt.sign(
    { sub: "ceo-1", typ: COS_PLAN_EXEC_TYP, plan_id: "plan-1" },
    SECRET,
    { expiresIn: "-1s" },
  );
  await expect(
    authMiddleware(makeServiceReq({ token }), {}, jest.fn()),
  ).rejects.toMatchObject({ code: "TOKEN_EXPIRED", http_status: 401 });
});

test("deactivated user kills the token even on an allowed route", async () => {
  mockIdentityCache.getAuthUser.mockResolvedValue({
    user_id: "ceo-1",
    status: "suspended",
  });
  await expect(
    authMiddleware(makeServiceReq(), {}, jest.fn()),
  ).rejects.toMatchObject({ code: "USER_INACTIVE", http_status: 401 });
});

test("a human token on a workspace route still goes through the idle check", async () => {
  // Regression guard: the service branch must key off typ, not the route.
  mockRedis.exists.mockResolvedValue(1);
  const token = jwt.sign({ sub: "u1", jti: "a1", sid: "sid-1" }, SECRET, {
    expiresIn: "45m",
  });
  const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/v1/goals" };
  const next = jest.fn();

  await authMiddleware(req, {}, next);

  expect(mockRedis.exists).toHaveBeenCalledWith("session:idle:sid-1");
  expect(next).toHaveBeenCalled();
  expect(req.user.is_service).toBeUndefined();
});
