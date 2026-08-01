"use strict";

/**
 * Idempotency middleware — header-gated replay of unsafe writes. Redis is
 * mocked (ioredis-shaped: set(k,v,"NX","EX",ttl) → "OK"|null, get, del).
 */

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};

jest.mock("../../../src/config/redis", () => ({ getClient: () => mockRedis }));
jest.mock("../../../src/config/logger", () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { idempotencyMiddleware, cacheKey } = require("../../../src/middleware/idempotency");

function mkReq(overrides = {}) {
  return {
    method: "POST",
    baseUrl: "/api/v1",
    path: "/tasks",
    headers: {},
    user: { user_id: "u1" },
    ...overrides,
  };
}

function mkRes() {
  const res = {
    statusCode: 200,
    headers: {},
    finishHandlers: [],
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json: jest.fn(function json(body) {
      this.body = body;
      return this;
    }),
    on(evt, cb) {
      if (evt === "finish") this.finishHandlers.push(cb);
    },
    emitFinish() {
      this.finishHandlers.forEach((h) => h());
    },
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.get.mockResolvedValue(null);
  mockRedis.del.mockResolvedValue(1);
});

test("no Idempotency-Key header → passes straight through, no Redis", async () => {
  const req = mkReq();
  const res = mkRes();
  const next = jest.fn();
  await idempotencyMiddleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockRedis.set).not.toHaveBeenCalled();
});

test("header on a GET (safe method) is ignored", async () => {
  const req = mkReq({ method: "GET", headers: { "idempotency-key": "k1" } });
  const res = mkRes();
  const next = jest.fn();
  await idempotencyMiddleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockRedis.set).not.toHaveBeenCalled();
});

test("first call claims the key and stores the success on finish", async () => {
  const req = mkReq({ headers: { "idempotency-key": "cos:p1:0" } });
  const res = mkRes();
  const next = jest.fn();
  await idempotencyMiddleware(req, res, next);

  // Claimed with NX + EX.
  expect(mockRedis.set).toHaveBeenCalledWith(expect.stringMatching(/^idem:/), "__pending__", "NX", "EX", expect.any(Number));
  expect(next).toHaveBeenCalledTimes(1);

  // Handler responds 201 with a body → stored on finish.
  res.statusCode = 201;
  res.json({ data: { task_id: "t-1" } });
  res.emitFinish();
  expect(mockRedis.set).toHaveBeenLastCalledWith(
    expect.stringMatching(/^idem:/),
    JSON.stringify({ status: 201, body: { data: { task_id: "t-1" } } }),
    "EX",
    expect.any(Number),
  );
});

test("a repeated call with a stored result replays it (no next)", async () => {
  mockRedis.set.mockResolvedValue(null); // NX fails — key exists
  mockRedis.get.mockResolvedValue(JSON.stringify({ status: 201, body: { data: { task_id: "t-1" } } }));
  const req = mkReq({ headers: { "idempotency-key": "cos:p1:0" } });
  const res = mkRes();
  const next = jest.fn();
  await idempotencyMiddleware(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(201);
  expect(res.json).toHaveBeenCalledWith({ data: { task_id: "t-1" } });
  expect(res.headers["Idempotency-Replayed"]).toBe("true");
});

test("an in-flight claim (PENDING) fails open so it can't deadlock", async () => {
  mockRedis.set.mockResolvedValue(null); // NX fails
  mockRedis.get.mockResolvedValue("__pending__");
  const req = mkReq({ headers: { "idempotency-key": "cos:p1:0" } });
  const res = mkRes();
  const next = jest.fn();
  await idempotencyMiddleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
});

test("a non-2xx response releases the claim so a retry can run", async () => {
  const req = mkReq({ headers: { "idempotency-key": "cos:p1:0" } });
  const res = mkRes();
  const next = jest.fn();
  await idempotencyMiddleware(req, res, next);

  res.statusCode = 422;
  res.json({ error: { code: "VALIDATION_ERROR" } });
  res.emitFinish();
  expect(mockRedis.del).toHaveBeenCalledWith(expect.stringMatching(/^idem:/));
});

test("a Redis error on claim fails open (write still proceeds)", async () => {
  mockRedis.set.mockRejectedValue(new Error("redis down"));
  const req = mkReq({ headers: { "idempotency-key": "cos:p1:0" } });
  const res = mkRes();
  const next = jest.fn();
  await idempotencyMiddleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
});

test("cacheKey scopes by user + method + path + client key", () => {
  const a = cacheKey(mkReq({ user: { user_id: "u1" } }), "k");
  const b = cacheKey(mkReq({ user: { user_id: "u2" } }), "k"); // different user
  const c = cacheKey(mkReq({ path: "/goals" }), "k"); // different path
  expect(a).not.toBe(b);
  expect(a).not.toBe(c);
  expect(a).toMatch(/^idem:[0-9a-f]{64}$/);
});
