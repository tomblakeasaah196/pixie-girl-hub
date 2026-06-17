"use strict";

/**
 * Service-level tests for messaging_accounts — focus: tokens are
 * never returned raw and the test-ping path picks the right provider
 * call per platform.
 */

jest.mock("../../../src/modules/messaging_accounts/messaging-accounts.repo", () => ({
  list: jest.fn(),
  get: jest.fn(),
  getRaw: jest.fn(),
  upsert: jest.fn(),
  setActive: jest.fn(),
  remove: jest.fn(),
}));
jest.mock("../../../src/services/encryption.service", () => ({
  encrypt: jest.fn((s) => `enc:${s}`),
  decrypt: jest.fn((s) => s.replace(/^enc:/, "")),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/config/env", () => ({
  config: { META_GRAPH_VERSION: "v21.0" },
}));
jest.mock("axios", () => ({
  get: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({}));

const repo = require("../../../src/modules/messaging_accounts/messaging-accounts.repo");
const crypto = require("../../../src/services/encryption.service");
const axios = require("axios");
const service = require("../../../src/modules/messaging_accounts/messaging-accounts.service");

describe("messaging_accounts.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("upsert encrypts the access_token and never returns ciphertext", async () => {
    repo.upsert.mockResolvedValue({
      account_id: "id-1",
      platform: "whatsapp",
      external_account_id: "PHONE1",
      display_name: "Pixie Care",
      has_access_token: true,
    });
    const result = await service.upsertAccount({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      input: {
        platform: "whatsapp",
        external_account_id: "PHONE1",
        display_name: "Pixie Care",
        access_token: "EAA-supersecret",
      },
    });
    expect(crypto.encrypt).toHaveBeenCalledWith("EAA-supersecret");
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token_enc: "enc:EAA-supersecret",
      }),
    );
    expect(result).not.toHaveProperty("access_token_enc");
    expect(result.has_access_token).toBe(true);
  });

  test("getAccount strips the access_token_enc field", async () => {
    repo.get.mockResolvedValue({
      account_id: "id-1",
      platform: "whatsapp",
      external_account_id: "PHONE1",
      display_name: "x",
      access_token_enc: "should-not-leak",
    });
    const r = await service.getAccount({ id: "id-1" });
    expect(r.access_token_enc).toBeUndefined();
  });

  test("testAccount calls Meta Graph for WhatsApp", async () => {
    repo.getRaw.mockResolvedValue({
      account_id: "id-1",
      platform: "whatsapp",
      external_account_id: "PHONE1",
      access_token_enc: "enc:EAA-token",
    });
    axios.get.mockResolvedValue({
      data: { id: "PHONE1", name: "Pixie Girl Care" },
    });
    const r = await service.testAccount({ id: "id-1" });
    expect(axios.get).toHaveBeenCalledTimes(1);
    const call = axios.get.mock.calls[0];
    expect(call[0]).toContain("https://graph.facebook.com/v21.0/PHONE1");
    expect(call[1].headers.Authorization).toBe("Bearer EAA-token");
    expect(r).toEqual({
      ok: true,
      platform: "whatsapp",
      provider_id: "PHONE1",
      provider_name: "Pixie Girl Care",
    });
  });

  test("testAccount refuses WhatsApp without a token", async () => {
    repo.getRaw.mockResolvedValue({
      account_id: "id-1",
      platform: "whatsapp",
      external_account_id: "PHONE1",
      access_token_enc: null,
    });
    await expect(service.testAccount({ id: "id-1" })).rejects.toMatchObject({
      code: "NO_TOKEN",
    });
  });

  test("testAccount surfaces 401/403 from Meta as 4xx", async () => {
    repo.getRaw.mockResolvedValue({
      account_id: "id-1",
      platform: "instagram",
      external_account_id: "IGBIZ1",
      access_token_enc: "enc:bad-token",
    });
    const err = Object.assign(new Error("unauthorized"), {
      response: { status: 401 },
    });
    axios.get.mockRejectedValue(err);
    await expect(service.testAccount({ id: "id-1" })).rejects.toMatchObject({
      http_status: 401,
    });
  });
});
