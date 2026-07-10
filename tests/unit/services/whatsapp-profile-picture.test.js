"use strict";

/**
 * whatsapp.service.setProfilePicture — the display-picture path.
 *
 * Verifies the full chain with Meta mocked: the App ID is derived from
 * the access token via debug_token (so the operator never supplies it),
 * the bytes go through the two-hop resumable upload, and the resulting
 * handle is written onto the business profile. Also covers the fallback
 * to a supplied App ID when debug_token can't answer.
 */

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../../src/config/env", () => ({
  config: { META_GRAPH_VERSION: "v21.0" },
}));
jest.mock(
  "../../../src/modules/messaging_accounts/messaging-accounts.service",
  () => ({
    resolveWhatsAppSendConfig: jest.fn().mockResolvedValue({
      account_id: "acc-1",
      phone_number_id: "PHONE1",
      access_token: "EAA-token",
      business_account_id: "WABA1",
    }),
  }),
);

const axios = require("axios");
const wa = require("../../../src/services/whatsapp.service");

describe("whatsapp.service.setProfilePicture", () => {
  beforeEach(() => jest.clearAllMocks());

  test("derives the app id from the token and uploads by handle", async () => {
    // debug_token → app id
    axios.get.mockResolvedValueOnce({ data: { data: { app_id: "999888" } } });
    // 1) create upload session  2) upload bytes → handle  3) set profile
    axios.post
      .mockResolvedValueOnce({ data: { id: "upload:SESSION" } })
      .mockResolvedValueOnce({ data: { h: "HANDLE123" } })
      .mockResolvedValueOnce({ data: { success: true } });

    const out = await wa.setProfilePicture({
      brand: "faitlynhair",
      app_id: null, // none supplied — must be derived
      buffer: Buffer.from([1, 2, 3, 4]),
      mime_type: "image/jpeg",
      filename: "profile.jpg",
    });

    expect(out).toEqual({ result: { success: true }, app_id: "999888" });

    // debug_token introspects the token with itself.
    expect(axios.get.mock.calls[0][0]).toContain("/debug_token");
    expect(axios.get.mock.calls[0][1].params).toMatchObject({
      input_token: "EAA-token",
      access_token: "EAA-token",
    });

    // Upload session opened on the DERIVED app id, not the phone number.
    expect(axios.post.mock.calls[0][0]).toContain("/999888/uploads");

    // Upload hop uses the "OAuth" auth scheme + file_offset header.
    const uploadHeaders = axios.post.mock.calls[1][2].headers;
    expect(uploadHeaders.Authorization).toBe("OAuth EAA-token");
    expect(uploadHeaders.file_offset).toBe("0");

    // The handle is written onto the business profile.
    const profileUrl = axios.post.mock.calls[2][0];
    const profileBody = axios.post.mock.calls[2][1];
    expect(profileUrl).toContain("/PHONE1/whatsapp_business_profile");
    expect(profileBody).toEqual({
      messaging_product: "whatsapp",
      profile_picture_handle: "HANDLE123",
    });
  });

  test("falls back to the supplied app id when debug_token fails", async () => {
    axios.get.mockRejectedValueOnce(new Error("debug_token unavailable"));
    axios.post
      .mockResolvedValueOnce({ data: { id: "upload:SESSION" } })
      .mockResolvedValueOnce({ data: { h: "HANDLE" } })
      .mockResolvedValueOnce({ data: { success: true } });

    const out = await wa.setProfilePicture({
      brand: "faitlynhair",
      app_id: "123123",
      buffer: Buffer.from([9, 9]),
      mime_type: "image/jpeg",
    });

    expect(out.app_id).toBe("123123");
    expect(axios.post.mock.calls[0][0]).toContain("/123123/uploads");
  });

  test("throws WA_NO_APP_ID when neither derivation nor a hint works", async () => {
    axios.get.mockResolvedValueOnce({ data: { data: {} } }); // no app_id
    await expect(
      wa.setProfilePicture({
        brand: "faitlynhair",
        app_id: null,
        buffer: Buffer.from([1]),
      }),
    ).rejects.toMatchObject({ code: "WA_NO_APP_ID", http_status: 412 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
