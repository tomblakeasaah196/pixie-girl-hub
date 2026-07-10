"use strict";

/**
 * Service-level tests for messaging_accounts — focus: tokens are
 * never returned raw and the test-ping path picks the right provider
 * call per platform.
 */

jest.mock(
  "../../../src/modules/messaging_accounts/messaging-accounts.repo",
  () => ({
    list: jest.fn(),
    get: jest.fn(),
    getRaw: jest.fn(),
    upsert: jest.fn(),
    setActive: jest.fn(),
    remove: jest.fn(),
  }),
);
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
    // Encrypted secrets are grouped under `secrets` (000289 contract):
    // the repo COALESCEs each field against the existing row so we can
    // rotate one secret without re-sending the others.
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: expect.objectContaining({
          access_token_enc: "enc:EAA-supersecret",
          access_token_first4: "EAA-",
        }),
      }),
    );
    expect(result).not.toHaveProperty("access_token_enc");
    expect(result.has_access_token).toBe(true);
  });

  test("getAccount never surfaces the access_token_enc column", async () => {
    // repo.get() now projects only PUBLIC_COLUMNS (no *_enc). The
    // service just passes the row through; the strip lives in SQL.
    repo.get.mockResolvedValue({
      account_id: "id-1",
      platform: "whatsapp",
      external_account_id: "PHONE1",
      display_name: "x",
      has_access_token: true,
      access_token_first4: "EAA-",
    });
    const r = await service.getAccount({ id: "id-1" });
    expect(r.access_token_enc).toBeUndefined();
    expect(r.access_token_first4).toBe("EAA-");
  });

  test("testAccount calls Meta Graph for WhatsApp", async () => {
    repo.getRaw.mockResolvedValue({
      account_id: "id-1",
      platform: "whatsapp",
      external_account_id: "PHONE1",
      access_token_enc: "enc:EAA-token",
    });
    axios.get.mockResolvedValue({
      data: { id: "PHONE1", verified_name: "Pixie Girl Care" },
    });
    const r = await service.testAccount({ id: "id-1" });
    expect(axios.get).toHaveBeenCalledTimes(1);
    const call = axios.get.mock.calls[0];
    expect(call[0]).toContain("https://graph.facebook.com/v21.0/PHONE1");
    // WhatsApp phone-number nodes have no `name` field — requesting it
    // 400s, so the ping must ask for verified_name instead.
    expect(call[0]).toContain("fields=id,verified_name");
    expect(call[0]).not.toContain("fields=id,name");
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

  test("testAccount surfaces Meta's structured error message (not axios's opaque 400)", async () => {
    repo.getRaw.mockResolvedValue({
      account_id: "id-1",
      platform: "instagram",
      external_account_id: "IGBIZ1",
      access_token_enc: "enc:bad-token",
    });
    // Axios collapses a Graph 400 to a useless message; Meta's real cause
    // lives in response.data.error. The test-ping must relay it.
    const err = Object.assign(new Error("Request failed with status code 400"), {
      response: {
        status: 400,
        data: {
          error: {
            message:
              "Unsupported get request. Object with ID 'IGBIZ1' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
            code: 100,
            error_subcode: 33,
            fbtrace_id: "AbCdEf123",
          },
        },
      },
    });
    axios.get.mockRejectedValue(err);
    await expect(service.testAccount({ id: "id-1" })).rejects.toMatchObject({
      http_status: 400,
      message: expect.stringContaining("Unsupported get request"),
    });
    const thrown = await service.testAccount({ id: "id-1" }).catch((e) => e);
    expect(thrown.message).toContain("code 100");
    expect(thrown.message).toContain("trace AbCdEf123");
  });
});
