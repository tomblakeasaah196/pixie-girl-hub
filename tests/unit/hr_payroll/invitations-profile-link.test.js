/**
 * Staff invitations — one login per staff profile.
 *
 * acceptInvitation must carry the invite's staff_profile_id onto the created
 * login (losing it orphans the account from its HR profile, so org-position
 * role grants resolve to a different login), and both accept + instant
 * provisioning must refuse a second login for an already-linked profile.
 */

"use strict";

jest.mock("../../../src/shared/hr_payroll/invitations.repo");
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/services/email.service", () => ({
  send: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("argon2", () => ({
  hash: jest.fn().mockResolvedValue("argon2-hash"),
}));
jest.mock("../../../src/utils/password", () => ({ hashOptions: {} }));
jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "http://localhost:7000" },
  validateEnv: () => {},
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn((fn) => fn({ query: jest.fn() })),
  query: jest.fn(),
  ex: () => jest.fn(),
}));

const repo = require("../../../src/shared/hr_payroll/invitations.repo");
const service = require("../../../src/shared/hr_payroll/invitations.service");
const { ConflictError } = require("../../../src/utils/errors");

const PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function pendingInvite(overrides = {}) {
  return {
    invitation_id: "inv-1",
    email: "elisha@example.com",
    display_name: "Elisha",
    status: "pending",
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    role_ids: [],
    business_keys: ["faitlynhair"],
    default_business: "faitlynhair",
    is_ceo: false,
    staff_profile_id: PROFILE_ID,
    invited_by: "admin-1",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.getByTokenHash.mockResolvedValue(pendingInvite());
  repo.userExistsByEmail.mockResolvedValue(null);
  repo.activeUserForProfile.mockResolvedValue(null);
  repo.createUser.mockResolvedValue({
    user_id: "new-user",
    email: "elisha@example.com",
  });
  repo.assignRole.mockResolvedValue(undefined);
  repo.setStatus.mockResolvedValue({});
});

describe("acceptInvitation", () => {
  test("links the created login to the invite's staff profile", async () => {
    await service.acceptInvitation({ token: "tok", password: "Passw0rd!" });
    expect(repo.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ staff_profile_id: PROFILE_ID }),
      }),
    );
  });

  test("refuses when the profile already has an active login", async () => {
    repo.activeUserForProfile.mockResolvedValue({
      user_id: "existing",
      email: "other@example.com",
    });
    await expect(
      service.acceptInvitation({ token: "tok", password: "Passw0rd!" }),
    ).rejects.toThrow(ConflictError);
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  test("invites without a staff profile skip the link check", async () => {
    repo.getByTokenHash.mockResolvedValue(
      pendingInvite({ staff_profile_id: null }),
    );
    await service.acceptInvitation({ token: "tok", password: "Passw0rd!" });
    expect(repo.activeUserForProfile).not.toHaveBeenCalled();
    expect(repo.createUser).toHaveBeenCalled();
  });
});

describe("provisionLogin", () => {
  test("refuses a second login for an already-linked profile", async () => {
    repo.activeUserForProfile.mockResolvedValue({
      user_id: "existing",
      email: "other@example.com",
    });
    await expect(
      service.provisionLogin({
        user: { user_id: "admin-1" },
        request_id: "r-1",
        input: {
          email: "second@example.com",
          staff_profile_id: PROFILE_ID,
          business_keys: ["faitlynhair"],
        },
      }),
    ).rejects.toThrow(ConflictError);
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  test("links the provisioned login to the staff profile", async () => {
    await service.provisionLogin({
      user: { user_id: "admin-1" },
      request_id: "r-1",
      input: {
        email: "elisha@example.com",
        staff_profile_id: PROFILE_ID,
        business_keys: ["faitlynhair"],
      },
    });
    expect(repo.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ staff_profile_id: PROFILE_ID }),
      }),
    );
  });
});
