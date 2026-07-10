"use strict";

/**
 * Service tests for the WhatsApp business-profile endpoints — focus:
 * the account must be WhatsApp, the display-picture upload needs a Meta
 * App ID (resolved from the row or the request), and text updates pass
 * straight through to whatsapp.service with an audit.
 */

jest.mock(
  "../../../src/modules/messaging_accounts/messaging-accounts.repo",
  () => ({
    getRaw: jest.fn(),
    setAppId: jest.fn(),
  }),
);
jest.mock("../../../src/services/whatsapp.service", () => ({
  getBusinessProfile: jest.fn(),
  updateBusinessProfile: jest.fn(),
  setProfilePicture: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/services/encryption.service", () => ({
  encrypt: jest.fn((s) => `enc:${s}`),
  decrypt: jest.fn((s) => s.replace(/^enc:/, "")),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({}));
jest.mock("../../../src/config/env", () => ({
  config: { META_GRAPH_VERSION: "v21.0" },
}));

const repo = require("../../../src/modules/messaging_accounts/messaging-accounts.repo");
const wa = require("../../../src/services/whatsapp.service");
const { audit } = require("../../../src/middleware/audit");
const service = require("../../../src/modules/messaging_accounts/messaging-accounts.service");

const waRow = (over = {}) => ({
  account_id: "acc-1",
  platform: "whatsapp",
  business: "pixiegirl",
  metadata: {},
  ...over,
});

describe("messaging_accounts.service — WhatsApp profile", () => {
  beforeEach(() => jest.clearAllMocks());

  test("getWhatsAppProfile returns the Meta profile plus stored app_id", async () => {
    repo.getRaw.mockResolvedValue(waRow({ metadata: { app_id: "123456" } }));
    wa.getBusinessProfile.mockResolvedValue({ about: "Premium hair" });
    const r = await service.getWhatsAppProfile({ id: "acc-1" });
    expect(wa.getBusinessProfile).toHaveBeenCalledWith({ brand: "pixiegirl" });
    expect(r).toEqual({ about: "Premium hair", app_id: "123456" });
  });

  test("getWhatsAppProfile refuses a non-WhatsApp account", async () => {
    repo.getRaw.mockResolvedValue(waRow({ platform: "instagram" }));
    await expect(
      service.getWhatsAppProfile({ id: "acc-1" }),
    ).rejects.toMatchObject({ code: "NOT_WHATSAPP", http_status: 400 });
  });

  test("updateWhatsAppProfile passes fields through and audits", async () => {
    repo.getRaw.mockResolvedValue(waRow());
    wa.updateBusinessProfile.mockResolvedValue({ success: true });
    const r = await service.updateWhatsAppProfile({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      id: "acc-1",
      profile: { about: "Hello", vertical: "RETAIL" },
    });
    expect(wa.updateBusinessProfile).toHaveBeenCalledWith({
      brand: "pixiegirl",
      profile: { about: "Hello", vertical: "RETAIL" },
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ success: true });
  });

  test("setWhatsAppProfilePicture rejects when no App ID is known", async () => {
    repo.getRaw.mockResolvedValue(waRow({ metadata: {} }));
    await expect(
      service.setWhatsAppProfilePicture({
        brand: "pixiegirl",
        user: { user_id: "u1" },
        request_id: "r1",
        id: "acc-1",
        file: { buffer: Buffer.from("img") },
        app_id: "",
      }),
    ).rejects.toMatchObject({ code: "WA_NO_APP_ID", http_status: 412 });
    expect(wa.setProfilePicture).not.toHaveBeenCalled();
  });

  test("setWhatsAppProfilePicture rejects a non-numeric App ID", async () => {
    repo.getRaw.mockResolvedValue(waRow());
    await expect(
      service.setWhatsAppProfilePicture({
        brand: "pixiegirl",
        user: { user_id: "u1" },
        request_id: "r1",
        id: "acc-1",
        file: { buffer: Buffer.from("img") },
        app_id: "not-a-number",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repo.setAppId).not.toHaveBeenCalled();
  });

  test("setWhatsAppProfilePicture requires a file", async () => {
    repo.getRaw.mockResolvedValue(waRow({ metadata: { app_id: "123" } }));
    await expect(
      service.setWhatsAppProfilePicture({
        brand: "pixiegirl",
        user: { user_id: "u1" },
        request_id: "r1",
        id: "acc-1",
        file: undefined,
        app_id: "123",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
