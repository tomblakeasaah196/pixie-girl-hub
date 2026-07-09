"use strict";

/**
 * Password-reset unit tests (§1.5). Mocks redis/email/repo/argon2/env so the
 * security-critical invariants are verified with no infra. The flow is a
 * one-time email CODE (OTP), not a link:
 *   - unknown/inactive accounts produce no code + no email (no enumeration)
 *   - the emailed value is a 6-digit numeric OTP, stored keyed by email w/ TTL
 *   - a resend cooldown blunts email-bombing
 *   - the code is single-use, wrong codes are attempt-limited, and a successful
 *     reset revokes only that user's sessions
 */

jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "http://localhost:7000" },
  validateEnv: () => {},
}));

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
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

const auth = require("../../../src/shared/hr_payroll/auth.service");

beforeEach(() => jest.clearAllMocks());

describe("forgotPassword", () => {
  test("unknown email → no code, no email (no enumeration)", async () => {
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

  test("active account → stores a 6-digit OTP keyed by email (w/ TTL) and emails that code", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue({
      user_id: "u1",
      email: "real@y.com",
      display_name: "Real",
      status: "active",
    });
    mockRedis.get.mockResolvedValue(null); // no active cooldown
    mockRedis.set.mockResolvedValue("OK");
    mockEmail.send.mockResolvedValue();

    await auth.forgotPassword({ email: "Real@Y.com" });

    expect(mockStaffRepo.findByEmail).toHaveBeenCalledWith("real@y.com"); // normalised
    expect(mockEmail.send).toHaveBeenCalledTimes(1);

    // First set is the OTP record keyed by email; second is the resend cooldown.
    const otpCall = mockRedis.set.mock.calls.find(([k]) =>
      k === "pwreset:real@y.com",
    );
    expect(otpCall).toBeTruthy();
    const [key, value, ex, ttl] = otpCall;
    expect(key).toBe("pwreset:real@y.com");
    const record = JSON.parse(value);
    expect(record.otp).toMatch(/^\d{6}$/); // crypto 6-digit numeric code
    expect(record.user_id).toBe("u1");
    expect(record.attempts).toBe(0);
    expect(ex).toBe("EX");
    expect(ttl).toBe(10 * 60); // OTP_TTL_SEC

    // The emailed code must equal the stored code, and never be a token link.
    const html = mockEmail.send.mock.calls[0][0].html;
    expect(html).toContain(record.otp);
    expect(html).not.toContain("reset-password?token=");
  });

  test("resend cooldown active → silently no-op (anti email-bomb)", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue({
      user_id: "u1",
      email: "real@y.com",
      status: "active",
    });
    mockRedis.get.mockResolvedValue("1"); // cooldown key present
    await auth.forgotPassword({ email: "real@y.com" });
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockEmail.send).not.toHaveBeenCalled();
  });

  test("email send failure does not throw (still no leak)", async () => {
    mockStaffRepo.findByEmail.mockResolvedValue({
      user_id: "u1",
      email: "real@y.com",
      status: "active",
    });
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockEmail.send.mockRejectedValue(new Error("smtp down"));
    await expect(
      auth.forgotPassword({ email: "real@y.com" }),
    ).resolves.toBeUndefined();
  });
});

describe("resetPassword", () => {
  test("rejects when the code is missing", async () => {
    await expect(
      auth.resetPassword({ email: "a@b.com", new_password: "LongEnough1!" }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
    expect(mockStaffRepo.updatePassword).not.toHaveBeenCalled();
  });

  test("rejects an expired/unknown code", async () => {
    mockRedis.get.mockResolvedValue(null);
    await expect(
      auth.resetPassword({
        email: "a@b.com",
        otp: "123456",
        new_password: "LongEnough1!",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
    expect(mockStaffRepo.updatePassword).not.toHaveBeenCalled();
  });

  test("rejects a too-short password before touching the stored code", async () => {
    await expect(
      auth.resetPassword({ email: "a@b.com", otp: "123456", new_password: "short" }),
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  test("wrong code → increments attempts and re-stores, does not reset", async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({ otp: "111111", user_id: "u1", attempts: 0 }),
    );
    mockRedis.ttl.mockResolvedValue(300);
    await expect(
      auth.resetPassword({
        email: "a@b.com",
        otp: "999999",
        new_password: "NewPassword123!",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
    expect(mockStaffRepo.updatePassword).not.toHaveBeenCalled();
    // Re-stored with the incremented attempt counter.
    const restore = mockRedis.set.mock.calls.find(([k]) => k === "pwreset:a@b.com");
    expect(JSON.parse(restore[1]).attempts).toBe(1);
  });

  test("too many wrong codes → burns the code (429)", async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({ otp: "111111", user_id: "u1", attempts: 4 }),
    );
    await expect(
      auth.resetPassword({
        email: "a@b.com",
        otp: "999999",
        new_password: "NewPassword123!",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    expect(mockRedis.del).toHaveBeenCalledWith("pwreset:a@b.com");
  });

  test("correct code → sets password, consumes code, revokes only this user's sessions", async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({ otp: "111111", user_id: "u1", attempts: 0 }),
    );
    mockRedis.del.mockResolvedValue(1);
    // One SCAN page: two refresh tokens, only j1 belongs to u1.
    mockRedis.scan.mockResolvedValue(["0", ["refresh:j1", "refresh:j2"]]);
    mockRedis.mget.mockResolvedValue(["u1", "u2"]);
    mockStaffRepo.updatePassword.mockResolvedValue();

    await auth.resetPassword({
      email: "a@b.com",
      otp: "111111",
      new_password: "NewPassword123!",
    });

    expect(mockStaffRepo.updatePassword).toHaveBeenCalledWith(
      "u1",
      "hashed:NewPassword123!",
    );
    expect(mockRedis.del).toHaveBeenCalledWith("pwreset:a@b.com"); // single-use
    expect(mockRedis.del).toHaveBeenCalledWith("refresh:j1"); // revoked
    expect(mockRedis.del).not.toHaveBeenCalledWith("refresh:j2"); // other user untouched
  });
});
