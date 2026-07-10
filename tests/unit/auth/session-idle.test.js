"use strict";

/**
 * Idle-session enforcement unit tests (forced re-login after inactivity).
 * Mocks redis/env/repos so the security invariants are verified with no
 * infra:
 *   - login mints a sid + auth_time into both JWTs and arms the redis idle
 *     marker with the configured TTL
 *   - refresh with a lapsed idle marker is rejected AND revokes the refresh
 *     jti (the cookie can never be replayed later)
 *   - only a user-activity refresh re-arms the window; background refreshes
 *     merely check it
 *   - sid/auth_time survive rotation, so the absolute session cap measures
 *     from the original login
 *   - refresh tokens minted before this enforcement (no sid) are revoked
 *   - the absolute cap rejects sessions older than SESSION_ABSOLUTE_MAX_S
 *   - logout kills the idle marker alongside the refresh jti
 */

const IDLE_TTL = 2700;
const ABSOLUTE_MAX = 14 * 24 * 60 * 60;
const SECRET = "test-secret-test-secret-test-secret!";

jest.mock("../../../src/config/env", () => ({
  config: {
    JWT_SECRET: "test-secret-test-secret-test-secret!",
    JWT_ACCESS_EXPIRES_IN: "45m",
    JWT_REFRESH_EXPIRES_IN: "14d",
    SESSION_IDLE_TIMEOUT_S: 2700,
    SESSION_ABSOLUTE_MAX_S: 14 * 24 * 60 * 60,
    APP_URL: "http://localhost:7000",
  },
  validateEnv: () => {},
}));

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
  expire: jest.fn(),
  exists: jest.fn(),
  scan: jest.fn(),
  mget: jest.fn(),
};
jest.mock("../../../src/config/redis", () => ({ getClient: () => mockRedis }));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../../src/services/email.service", () => ({ send: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const mockStaffRepo = {
  findByEmail: jest.fn(),
  recordSuccessfulLogin: jest.fn(),
  recordFailedLogin: jest.fn(),
};
jest.mock("../../../src/shared/hr_payroll/staff.repo", () => mockStaffRepo);

const mockIamRepo = { createSession: jest.fn() };
jest.mock("../../../src/shared/iam/iam.repo", () => mockIamRepo);

jest.mock("argon2", () => ({
  hash: jest.fn(async (p) => `hashed:${p}`),
  verify: jest.fn(async () => true),
}));

const jwt = require("jsonwebtoken");
const auth = require("../../../src/shared/hr_payroll/auth.service");

beforeEach(() => jest.clearAllMocks());

const USER = {
  user_id: "u1",
  email: "ceo@pixie.com",
  display_name: "CEO",
  is_ceo: true,
  status: "active",
  password_hash: "hashed:pw",
};

/** Craft a refresh token the way issueTokens does (or with holes, to model
 *  legacy/expired sessions). */
function makeRefreshToken(overrides = {}) {
  return jwt.sign(
    {
      sub: "u1",
      jti: "refresh-jti-1",
      sid: "sid-1",
      auth_time: Math.floor(Date.now() / 1000) - 60,
      type: "refresh",
      ...overrides,
    },
    SECRET,
    { expiresIn: "14d" },
  );
}

/** Redis state for a refresh whose jti is stored and idle marker matters. */
function armRedis({ idleAlive }) {
  mockRedis.get.mockResolvedValue("u1"); // refresh:{jti} → user id
  mockRedis.exists.mockResolvedValue(idleAlive ? 1 : 0);
  mockRedis.expire.mockResolvedValue(idleAlive ? 1 : 0);
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.del.mockResolvedValue(1);
}

describe("login → idle-session seeding", () => {
  test("mints sid + auth_time into both tokens and arms the idle marker", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue(USER);
    mockRedis.set.mockResolvedValue("OK");

    const before = Math.floor(Date.now() / 1000);
    const result = await auth.login({ email: USER.email, password: "pw" });

    const access = jwt.verify(result.access_token, SECRET);
    const refresh = jwt.verify(result.refresh_token, SECRET);
    expect(access.sid).toBeTruthy();
    expect(refresh.sid).toBe(access.sid);
    expect(refresh.auth_time).toBeGreaterThanOrEqual(before);
    expect(result.idle_timeout_s).toBe(IDLE_TTL);

    const idleSet = mockRedis.set.mock.calls.find(([k]) =>
      k.startsWith("session:idle:"),
    );
    expect(idleSet).toEqual([
      `session:idle:${access.sid}`,
      "u1",
      "EX",
      IDLE_TTL,
    ]);
  });
});

describe("refresh — idle window", () => {
  test("lapsed idle marker → SESSION_IDLE_TIMEOUT and the refresh jti is revoked", async () => {
    armRedis({ idleAlive: false });
    await expect(
      auth.refresh({ refresh_token: makeRefreshToken() }),
    ).rejects.toMatchObject({ code: "SESSION_IDLE_TIMEOUT", http_status: 401 });
    // The cookie is dead forever, not just rejected this once.
    expect(mockRedis.del).toHaveBeenCalledWith("refresh:refresh-jti-1");
    // No new tokens were stored.
    expect(
      mockRedis.set.mock.calls.filter(([k]) => k.startsWith("refresh:")),
    ).toHaveLength(0);
  });

  test("user-activity refresh re-arms the window (EXPIRE) and rotates", async () => {
    armRedis({ idleAlive: true });
    const result = await auth.refresh({
      refresh_token: makeRefreshToken(),
      user_active: true,
    });
    expect(mockRedis.expire).toHaveBeenCalledWith(
      "session:idle:sid-1",
      IDLE_TTL,
    );
    expect(mockRedis.exists).not.toHaveBeenCalled();
    const rotated = jwt.verify(result.refresh_token, SECRET);
    expect(rotated.sid).toBe("sid-1");
    expect(rotated.jti).not.toBe("refresh-jti-1");
  });

  test("background refresh only checks the window — never re-arms it", async () => {
    armRedis({ idleAlive: true });
    await auth.refresh({ refresh_token: makeRefreshToken() });
    expect(mockRedis.exists).toHaveBeenCalledWith("session:idle:sid-1");
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  test("auth_time survives rotation so the absolute cap can't slide", async () => {
    armRedis({ idleAlive: true });
    const auth_time = Math.floor(Date.now() / 1000) - 12345;
    const result = await auth.refresh({
      refresh_token: makeRefreshToken({ auth_time }),
    });
    expect(jwt.verify(result.refresh_token, SECRET).auth_time).toBe(auth_time);
  });

  test("legacy refresh token (no sid) is revoked — one-time forced re-login", async () => {
    armRedis({ idleAlive: true });
    const legacy = jwt.sign(
      { sub: "u1", jti: "legacy-jti", type: "refresh" },
      SECRET,
      { expiresIn: "14d" },
    );
    await expect(auth.refresh({ refresh_token: legacy })).rejects.toMatchObject(
      { code: "TOKEN_REVOKED", http_status: 401 },
    );
    expect(mockRedis.del).toHaveBeenCalledWith("refresh:legacy-jti");
  });

  test("session older than the absolute cap → SESSION_EXPIRED, jti + idle marker revoked", async () => {
    armRedis({ idleAlive: true });
    const token = makeRefreshToken({
      auth_time: Math.floor(Date.now() / 1000) - ABSOLUTE_MAX - 60,
    });
    await expect(auth.refresh({ refresh_token: token })).rejects.toMatchObject(
      { code: "SESSION_EXPIRED", http_status: 401 },
    );
    expect(mockRedis.del).toHaveBeenCalledWith("refresh:refresh-jti-1");
    expect(mockRedis.del).toHaveBeenCalledWith("session:idle:sid-1");
  });
});

describe("logout", () => {
  test("kills the idle marker alongside the refresh jti", async () => {
    mockRedis.del.mockResolvedValue(1);
    await auth.logout({ refresh_token: makeRefreshToken() });
    expect(mockRedis.del).toHaveBeenCalledWith("refresh:refresh-jti-1");
    expect(mockRedis.del).toHaveBeenCalledWith("session:idle:sid-1");
  });
});
