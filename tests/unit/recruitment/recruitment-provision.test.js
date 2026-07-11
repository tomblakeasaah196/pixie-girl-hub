/**
 * Recruitment — provisioning creates a FULL employee account.
 *
 * provisionCredentials must carry the onboarding wizard's staff_profile_id
 * through to the HR login provisioner (losing it orphans the login from the
 * HR profile, so the hire never shows in the directory / organigramme), honour
 * a role_ids override (the seated position's role), and file the generated
 * employment contract under the employee's HR contracts.
 */

"use strict";

jest.mock("../../../src/modules/recruitment/recruitment.repo");
jest.mock("../../../src/modules/recruitment/recruitment.ai", () => ({
  draft: jest.fn(),
}));
jest.mock("../../../src/modules/recruitment/recruitment.render", () => ({
  offerPacketHtml: jest.fn(),
  jobDescriptionHtml: jest.fn(),
  offerLetterHtml: jest.fn(),
  contractHtml: jest.fn(),
  renderForWeb: jest.fn(),
  pdfDocOptions: jest.fn(),
}));
jest.mock("../../../src/modules/recruitment/recruitment.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/services/pdf.service", () => ({
  renderHtmlToPdf: jest.fn(),
  renderAndStore: jest.fn(),
}));
jest.mock("../../../src/services/storage.service", () => ({
  get: jest.fn(),
}));
jest.mock("../../../src/shared/documents/documents.esign.service", () => ({
  createRequest: jest.fn(),
  viewByToken: jest.fn(),
  signByToken: jest.fn(),
}));
jest.mock("../../../src/shared/hr_payroll/invitations.service", () => ({
  provisionLogin: jest.fn(),
}));
jest.mock("../../../src/shared/hr_payroll/contracts.repo", () => ({
  createContract: jest.fn(),
}));
jest.mock("../../../src/services/email.service", () => ({
  send: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "http://localhost:7000" },
  validateEnv: () => {},
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const repo = require("../../../src/modules/recruitment/recruitment.repo");
const invitations = require("../../../src/shared/hr_payroll/invitations.service");
const contractsRepo = require("../../../src/shared/hr_payroll/contracts.repo");
const service = require("../../../src/modules/recruitment/recruitment.service");
const { AppError, ConflictError } = require("../../../src/utils/errors");

const OFFER_ID = "11111111-1111-1111-1111-111111111111";
const PROFILE_ID = "22222222-2222-2222-2222-222222222222";
const OFFER_ROLE = "33333333-3333-3333-3333-333333333333";
const SEAT_ROLE = "44444444-4444-4444-4444-444444444444";

const offer = (overrides = {}) => ({
  offer_id: OFFER_ID,
  business: "faitlynhair",
  title: "Marketing & Business Development Officer",
  candidate_name: "Jane Doe",
  candidate_email: "jane@example.com",
  target_businesses: ["pixiegirl", "faitlynhair"],
  status: "contracted",
  role_ids: [OFFER_ROLE],
  is_ceo: false,
  provisioned_user_id: null,
  contract_document_id: "55555555-5555-5555-5555-555555555555",
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  repo.getOffer.mockResolvedValue(offer());
  repo.getContext.mockResolvedValue([]);
  repo.businessBranding.mockResolvedValue(null);
  repo.userIdByEmail.mockResolvedValue("new-user-id");
  repo.updateOffer.mockResolvedValue(offer({ status: "provisioned" }));
  repo.staffProfileBrief.mockResolvedValue({
    profile_id: PROFILE_ID,
    business: "faitlynhair",
    employment_type: "full_time",
    start_date: "2026-07-14",
    base_salary: "220000.00",
    is_deleted: false,
  });
  invitations.provisionLogin.mockResolvedValue({
    email: "jane@example.com",
    temp_password: "Temp-1234!",
    force_password_reset: true,
  });
  contractsRepo.createContract.mockResolvedValue({});
});

const call = (input) =>
  service.provisionCredentials({
    brand: "faitlynhair",
    user: { user_id: "admin-1" },
    request_id: "r-1",
    id: OFFER_ID,
    input,
  });

describe("provisionCredentials — full employee account", () => {
  test("links the login to the onboarding wizard's staff profile", async () => {
    await call({ staff_profile_id: PROFILE_ID });
    expect(invitations.provisionLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ staff_profile_id: PROFILE_ID }),
      }),
    );
  });

  test("files the employment contract under the linked HR profile", async () => {
    await call({ staff_profile_id: PROFILE_ID });
    expect(contractsRepo.createContract).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          profile_id: PROFILE_ID,
          contract_type: "full_time",
          effective_from: "2026-07-14",
          document_id: "55555555-5555-5555-5555-555555555555",
        }),
      }),
    );
  });

  test("role_ids override (the seated position's role) beats the offer's grants", async () => {
    await call({ staff_profile_id: PROFILE_ID, role_ids: [SEAT_ROLE] });
    expect(invitations.provisionLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ role_ids: [SEAT_ROLE] }),
      }),
    );
  });

  test("defaults to the offer's stored role grants without an override", async () => {
    await call({});
    expect(invitations.provisionLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          role_ids: [OFFER_ROLE],
          staff_profile_id: null,
        }),
      }),
    );
    expect(contractsRepo.createContract).not.toHaveBeenCalled();
  });

  test("422 when the staff profile to link does not exist", async () => {
    repo.staffProfileBrief.mockResolvedValue(null);
    await expect(call({ staff_profile_id: PROFILE_ID })).rejects.toThrow(AppError);
    expect(invitations.provisionLogin).not.toHaveBeenCalled();
  });

  test("still refuses to provision an unsigned offer", async () => {
    repo.getOffer.mockResolvedValue(offer({ status: "sent" }));
    await expect(call({ staff_profile_id: PROFILE_ID })).rejects.toThrow(ConflictError);
  });

  test("a contract-filing hiccup never unwinds the provisioned login", async () => {
    contractsRepo.createContract.mockRejectedValue(new Error("db down"));
    const out = await call({ staff_profile_id: PROFILE_ID });
    expect(out).toEqual(
      expect.objectContaining({ emailed: true, user_id: "new-user-id" }),
    );
  });
});
