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
    updateExternalId: jest.fn(),
    listActiveByPlatform: jest.fn(),
    rotateAccessToken: jest.fn(),
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
  post: jest.fn(),
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

  test("testAccount pings graph.instagram.com/me for Instagram (IG Login token)", async () => {
    repo.getRaw.mockResolvedValue({
      account_id: "id-2",
      platform: "instagram",
      external_account_id: "17841400000000000",
      access_token_enc: "enc:IGAA-token",
    });
    axios.get.mockImplementation((url) =>
      url.includes("/me/subscribed_apps")
        ? Promise.resolve({
            data: {
              data: [
                {
                  subscribed_fields: [
                    "messages",
                    "message_reactions",
                    "messaging_seen",
                  ],
                },
              ],
            },
          })
        : Promise.resolve({
            data: { user_id: "17841400000000000", username: "faitlynhair" },
          }),
    );
    const r = await service.testAccount({ id: "id-2" });
    const call = axios.get.mock.calls[0];
    // IG Login tokens only authenticate against graph.instagram.com — the
    // ping must NOT hit graph.facebook.com (that 401s), and uses the `me`
    // self node so the exact account id isn't required.
    expect(call[0]).toContain("https://graph.instagram.com/v21.0/me");
    expect(call[0]).toContain("fields=user_id,username");
    expect(call[0]).not.toContain("graph.facebook.com");
    expect(call[1].headers.Authorization).toBe("Bearer IGAA-token");
    // Stored id already matches Meta's → no heal.
    expect(repo.updateExternalId).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      ok: true,
      platform: "instagram",
      provider_id: "17841400000000000",
      provider_name: "faitlynhair",
      healed: false,
      // Webhook subscriptions are verified in the same Test click — all
      // fields present → nothing to heal, no POST.
      echo_sync: { ok: true, healed: false },
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("testAccount repairs dropped webhook subscriptions (self-heal, never posting message_echoes)", async () => {
    repo.getRaw.mockResolvedValue({
      account_id: "id-2",
      platform: "instagram",
      external_account_id: "17841400000000000",
      access_token_enc: "enc:IGAA-token",
    });
    // subscribed_apps first returns a drifted list (echoes missing), then —
    // after the repair POST — the full list.
    let subCalls = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes("/me/subscribed_apps")) {
        subCalls += 1;
        return Promise.resolve({
          data: {
            data: [
              {
                subscribed_fields:
                  subCalls === 1
                    ? ["messages"]
                    : ["messages", "message_reactions", "messaging_seen"],
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: { user_id: "17841400000000000", username: "faitlynhair" },
      });
    });
    axios.post.mockResolvedValue({ data: { success: true } });

    const r = await service.testAccount({ id: "id-2" });

    // The repair POST must send the UNION (subscribed_apps REPLACES the
    // list — a partial re-subscribe is exactly how the field gets lost).
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [postUrl, , postOpts] = axios.post.mock.calls[0];
    expect(postUrl).toContain("/me/subscribed_apps");
    const sent = postOpts.params.subscribed_fields.split(",");
    expect(sent).toEqual(
      expect.arrayContaining([
        "messages",
        "message_reactions",
        "messaging_seen",
      ]),
    );
    // Messenger-only field — must never be posted on Instagram (it can
    // make Meta reject the whole subscription update).
    expect(sent).not.toContain("message_echoes");
    expect(r.echo_sync).toMatchObject({
      ok: true,
      healed: true,
      missing_before: expect.arrayContaining(["message_reactions"]),
    });
  });

  test("testAccount auto-heals a mistyped IG provider id from /me", async () => {
    // Operator saved the Business-Manager asset id; Meta's webhooks route
    // by the Graph user id — Test must correct the row.
    repo.getRaw.mockResolvedValue({
      account_id: "id-2",
      platform: "instagram",
      external_account_id: "1309705977894720",
      access_token_enc: "enc:IGAA-token",
    });
    axios.get.mockResolvedValue({
      data: { user_id: "17841401903263911", username: "faitlynhair" },
    });
    repo.updateExternalId.mockResolvedValue({
      account_id: "id-2",
      external_account_id: "17841401903263911",
    });
    const r = await service.testAccount({ id: "id-2" });
    expect(repo.updateExternalId).toHaveBeenCalledWith({
      id: "id-2",
      external_account_id: "17841401903263911",
    });
    expect(r.healed).toBe(true);
    expect(r.provider_id).toBe("17841401903263911");
  });

  test("refreshInstagramTokens rotates stale tokens via graph.instagram.com", async () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    repo.listActiveByPlatform.mockResolvedValue([
      {
        account_id: "id-2",
        business: "faitlynhair",
        platform: "instagram",
        access_token_enc: "enc:IGAA-old",
        secrets_last_rotated_at: eightDaysAgo,
      },
      {
        // Rotated an hour ago — must be skipped, not refreshed daily.
        account_id: "id-3",
        business: "pixiegirl",
        platform: "instagram",
        access_token_enc: "enc:IGAA-fresh",
        secrets_last_rotated_at: new Date().toISOString(),
      },
    ]);
    axios.get.mockResolvedValue({
      data: { access_token: "IGAA-new-token", expires_in: 5184000 },
    });
    repo.rotateAccessToken.mockResolvedValue({ account_id: "id-2" });

    const summary = await service.refreshInstagramTokens();

    expect(summary).toMatchObject({ checked: 2, refreshed: 1, skipped: 1, failed: 0 });
    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toBe("https://graph.instagram.com/refresh_access_token");
    expect(opts.params).toMatchObject({
      grant_type: "ig_refresh_token",
      access_token: "IGAA-old",
    });
    expect(repo.rotateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "id-2",
        access_token_enc: "enc:IGAA-new-token",
        access_token_first4: "IGAA",
      }),
    );
  });

  test("refreshInstagramTokens isolates one account's failure", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    repo.listActiveByPlatform.mockResolvedValue([
      {
        account_id: "id-bad",
        business: "pixiegirl",
        platform: "instagram",
        access_token_enc: "enc:IGAA-revoked",
        secrets_last_rotated_at: old,
      },
      {
        account_id: "id-good",
        business: "faitlynhair",
        platform: "instagram",
        access_token_enc: "enc:IGAA-ok",
        secrets_last_rotated_at: old,
      },
    ]);
    axios.get
      .mockRejectedValueOnce(
        Object.assign(new Error("revoked"), { response: { status: 400 } }),
      )
      .mockResolvedValueOnce({
        data: { access_token: "IGAA-renewed", expires_in: 5184000 },
      });
    repo.rotateAccessToken.mockResolvedValue({ account_id: "id-good" });

    const summary = await service.refreshInstagramTokens();
    expect(summary).toMatchObject({ refreshed: 1, failed: 1 });
    expect(repo.rotateAccessToken).toHaveBeenCalledTimes(1);
    expect(repo.rotateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: "id-good" }),
    );
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
