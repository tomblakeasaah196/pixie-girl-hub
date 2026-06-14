"use strict";

/**
 * Password-reset unit tests (§1.5). Mocks redis/email/repo/argon2/env so the
 * security-critical invariants are verified with no infra:
 *   - only the SHA-256 HASH of the token is stored (raw token only emailed)
 *   - unknown/inactive accounts produce no token + no email (no enumeration)
 *   - the token is single-use and all sessions are revoked on reset
 */

jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "http://localhost:7000", PASSWORD_RESET_TTL_MIN: 30 },
  validateEnv: () => {},
}));

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  mget: jest.fn(),
};
jest.mock("../../../src/config/redis", () => ({ getClient: () => mockRedis }));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const mockEmail = { send: jest.fn() };
jest.mock("../../../src/services/email.service", () => mockEmail);

const mockStaffRepo = { findByEmail: jest.fn(), updatePassword: jest.fn() };
jest.mock("../../../src/shared/hr_payroll/staff.repo", () => mockStaffRepo);

jest.mock("argon2", () => ({ hash: jest.fn(async (p) => `hashed:${p}`) }));

const crypto = require("crypto");
const auth = require("../../../src/shared/hr_payroll/auth.service");
const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

beforeEach(() => jest.clearAllMocks());

describe("forgotPassword", () => {
  test("unknown email → no token, no email (no enumeration)", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue(null);
    await auth.forgotPassword({ email: "ghost@example.com" });
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockEmail.send).not.toHaveBeenCalled();
  });

  test("non-active account → nothing happens", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue({
      user_id: "u1",
      email: "x@y.com",
      status: "locked",
    });
    await auth.forgotPassword({ email: "x@y.com" });
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockEmail.send).not.toHaveBeenCalled();
  });

  test("active account → stores the HASH of the emailed token, with TTL", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue({
      user_id: "u1",
      email: "real@y.com",
      display_name: "Real",
      status: "active",
    });
    mockRedis.set.mockResolvedValue("OK");
    mockEmail.send.mockResolvedValue();

    await auth.forgotPassword({ email: "Real@Y.com" });

    expect(mockStaffRepo.findByEmail).toHaveBeenCalledWith("real@y.com"); // normalised
    expect(mockEmail.send).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledTimes(1);

    // The raw token only appears in the email; redis must hold its hash only.
    const html = mockEmail.send.mock.calls[0][0].html;
    const raw = (html.match(/reset-password\?token=([a-f0-9]+)/) || [])[1];
    expect(raw).toBeTruthy();
    const [key, value, ex, ttl] = mockRedis.set.mock.calls[0];
    expect(key).toBe(`pwreset:${sha256(raw)}`);
    expect(html).not.toContain(sha256(raw)); // hash never emailed
    expect(value).toBe("u1");
    expect(ex).toBe("EX");
    expect(ttl).toBe(30 * 60);
  });

  test("email send failure does not throw (still no leak)", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue({
      user_id: "u1",
      email: "real@y.com",
      status: "active",
    });
    mockRedis.set.mockResolvedValue("OK");
    mockEmail.send.mockRejectedValue(new Error("smtp down"));
    await expect(
      auth.forgotPassword({ email: "real@y.com" }),
    ).resolves.toBeUndefined();
  });
});

describe("resetPassword", () => {
  test("rejects an invalid/expired token", async () => {
    mockRedis.get.mockResolvedValue(null);
    await expect(
      auth.resetPassword({ token: "abc", new_password: "longenough1" }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    expect(mockStaffRepo.updatePassword).not.toHaveBeenCalled();
  });

  test("rejects a too-short password before touching redis", async () => {
    await expect(
      auth.resetPassword({ token: "abc", new_password: "short" }),
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  test("valid token → sets password, consumes token, revokes only this user's sessions", async () => {
    mockRedis.get.mockResolvedValue("u1");
    mockRedis.del.mockResolvedValue(1);
    // One SCAN page: two refresh tokens, only j1 belongs to u1.
    mockRedis.scan.mockResolvedValue(["0", ["refresh:j1", "refresh:j2"]]);
    mockRedis.mget.mockResolvedValue(["u1", "u2"]);
    mockStaffRepo.updatePassword.mockResolvedValue();

    await auth.resetPassword({
      token: "rawtok",
      new_password: "newpassword123",
    });

    expect(mockStaffRepo.updatePassword).toHaveBeenCalledWith(
      "u1",
      "hashed:newpassword123",
    );
    expect(mockRedis.del).toHaveBeenCalledWith(`pwreset:${sha256("rawtok")}`); // single-use
    expect(mockRedis.del).toHaveBeenCalledWith("refresh:j1"); // revoked
    expect(mockRedis.del).not.toHaveBeenCalledWith("refresh:j2"); // other user untouched
  });
});
