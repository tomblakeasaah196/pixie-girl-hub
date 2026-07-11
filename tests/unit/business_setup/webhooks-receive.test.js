"use strict";

/**
 * receive() — the inbound webhook front door. Focus: every delivery that
 * reaches the endpoint MUST produce a webhook_log row. webhook_log.event_type
 * is NOT NULL, and Meta (WhatsApp/Instagram) payloads carry no top-level
 * event/type/event_type key — only `object` — so the event_type derivation
 * must never come out null (a null 23502'd the insert and bounced every
 * Meta webhook with a 400 before it could be logged).
 */

jest.mock("../../../src/config/env", () => ({
  config: { META_GRAPH_VERSION: "v21.0" },
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ query: jest.fn() })),
  query: jest.fn(),
}));
jest.mock("../../../src/config/request-context", () => ({}));
jest.mock("../../../src/shared/outbox/outbox", () => ({
  enqueue: jest.fn(),
  register: jest.fn(),
}));
jest.mock("../../../src/services/paystack.service", () => ({}));
jest.mock("../../../src/services/opay.service", () => ({}));
jest.mock("../../../src/services/nomba.service", () => ({}));
jest.mock("../../../src/services/stripe.service", () => ({}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({}));
jest.mock("../../../src/modules/business_setup/webhooks.repo", () => ({
  insertLog: jest.fn().mockResolvedValue({ webhook_id: "wh-1", duplicate: false }),
  findById: jest.fn(),
  markProcessed: jest.fn(),
  listReplayable: jest.fn(),
}));
jest.mock(
  "../../../src/modules/messaging_accounts/messaging-accounts.repo",
  () => ({
    findByExternalId: jest.fn().mockResolvedValue(null),
    listActiveByPlatform: jest.fn().mockResolvedValue([]),
    updateExternalId: jest.fn().mockResolvedValue(null),
  }),
);
jest.mock("../../../src/services/encryption.service", () => ({
  encrypt: jest.fn((s) => `enc:${s}`),
  decrypt: jest.fn((s) => String(s).replace(/^enc:/, "")),
}));

const nodeCrypto = require("crypto");
const repo = require("../../../src/modules/business_setup/webhooks.repo");
const maRepo = require("../../../src/modules/messaging_accounts/messaging-accounts.repo");
const service = require("../../../src/modules/business_setup/webhooks.service");

describe("webhooks.receive event_type derivation", () => {
  beforeEach(() => jest.clearAllMocks());

  test("Meta WhatsApp payload (no event/type keys) still logs with a non-null event_type", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1610195400723579",
          changes: [
            {
              field: "messages",
              value: { metadata: { phone_number_id: "1229217556937288" } },
            },
          ],
        },
      ],
    };
    const r = await service.receive("meta_whatsapp", {
      rawBody: Buffer.from(JSON.stringify(payload)),
      headers: {},
      ip: "127.0.0.1",
    });
    expect(r.status).toBe(200);
    expect(repo.insertLog).toHaveBeenCalled();
    const arg = repo.insertLog.mock.calls[0][1];
    expect(arg.event_type).toBe("whatsapp_business_account");
    expect(arg.event_type).not.toBeNull();
  });

  test("payload with none of the known keys falls back to 'unknown'", async () => {
    const r = await service.receive("meta_instagram", {
      rawBody: Buffer.from("{}"),
      headers: {},
      ip: "127.0.0.1",
    });
    expect(r.status).toBe(200);
    const arg = repo.insertLog.mock.calls[0][1];
    expect(arg.event_type).toBe("unknown");
  });

  test("gateway payloads keep their native event keys (paystack `event`)", async () => {
    const payload = { event: "charge.success", data: { reference: "ref-1" } };
    const r = await service.receive("paystack", {
      rawBody: Buffer.from(JSON.stringify(payload)),
      headers: {},
      ip: "127.0.0.1",
    });
    expect(r.status).toBe(200);
    const arg = repo.insertLog.mock.calls[0][1];
    expect(arg.event_type).toBe("charge.success");
  });
});

describe("meta_instagram signature verification with sole-active-row fallback", () => {
  const IG_ROW = {
    account_id: "acc-ig-1",
    business: "faitlynhair",
    platform: "instagram",
    external_account_id: "1309705977894720", // mistyped by the operator
    app_secret_enc: "enc:shhh-app-secret",
    is_active: true,
  };
  const payload = {
    object: "instagram",
    entry: [
      {
        id: "17841401903263911", // the id Meta ACTUALLY sends
        messaging: [
          { sender: { id: "IGSID_1" }, message: { mid: "m.1", text: "hi" } },
        ],
      },
    ],
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const goodSig =
    "sha256=" +
    nodeCrypto
      .createHmac("sha256", "shhh-app-secret")
      .update(rawBody)
      .digest("hex");

  beforeEach(() => {
    jest.clearAllMocks();
    repo.insertLog.mockResolvedValue({ webhook_id: "wh-9", duplicate: false });
  });

  test("valid HMAC via fallback row → accepted + provider id auto-healed", async () => {
    maRepo.findByExternalId.mockResolvedValue(null); // wrong stored id
    maRepo.listActiveByPlatform.mockResolvedValue([IG_ROW]);
    maRepo.updateExternalId.mockResolvedValue({
      account_id: "acc-ig-1",
      external_account_id: "17841401903263911",
    });

    const r = await service.receive("meta_instagram", {
      rawBody,
      headers: { "x-hub-signature-256": goodSig },
      ip: "127.0.0.1",
    });

    expect(r.status).toBe(200);
    expect(maRepo.updateExternalId).toHaveBeenCalledWith({
      id: "acc-ig-1",
      external_account_id: "17841401903263911",
    });
    // Logged as signature-valid so the outbox processes it.
    const arg = repo.insertLog.mock.calls[0][1];
    expect(arg.signature_valid).toBe(true);
  });

  test("invalid HMAC via fallback row → 401, no heal", async () => {
    maRepo.findByExternalId.mockResolvedValue(null);
    maRepo.listActiveByPlatform.mockResolvedValue([IG_ROW]);

    const r = await service.receive("meta_instagram", {
      rawBody,
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      ip: "127.0.0.1",
    });

    expect(r.status).toBe(401);
    expect(maRepo.updateExternalId).not.toHaveBeenCalled();
  });

  test("two active IG rows → no fallback (cannot guess between brands)", async () => {
    maRepo.findByExternalId.mockResolvedValue(null);
    maRepo.listActiveByPlatform.mockResolvedValue([
      IG_ROW,
      { ...IG_ROW, account_id: "acc-ig-2", business: "pixiegirl" },
    ]);

    const r = await service.receive("meta_instagram", {
      rawBody,
      headers: { "x-hub-signature-256": goodSig },
      ip: "127.0.0.1",
    });

    // No verifier resolvable → logged unverified (200) but never processed.
    expect(r.status).toBe(200);
    const arg = repo.insertLog.mock.calls[0][1];
    expect(arg.signature_valid).toBe(false);
    expect(maRepo.updateExternalId).not.toHaveBeenCalled();
  });
});
