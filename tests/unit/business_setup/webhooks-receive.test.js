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
    listByPlatform: jest.fn().mockResolvedValue([]),
  }),
);

const repo = require("../../../src/modules/business_setup/webhooks.repo");
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
