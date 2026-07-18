"use strict";

/**
 * The smartcomm webhook consumer's recovery contract. Messaging webhooks
 * (Instagram echoes above all) used to be unrescuable: webhook-dispatch
 * marked the log row processed immediately, so once the outbox retries
 * were exhausted the 30-min replay sweep could never see the failure.
 * Now THIS consumer owns webhook_log.processed for the inbox sources:
 *
 *   - full ingest success  → processed = true (error_message null)
 *   - any ingest failure   → error recorded on the row + rethrown
 *     (outbox retries now, replay sweep later)
 *   - an echo event routes to recordAgentReplyFromPlatform (business
 *     bubble), never to recordInboundFromCustomer
 */

jest.mock("../../../src/shared/outbox/outbox", () => ({
  register: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) =>
    fn({ query: jest.fn().mockResolvedValue({ rows: [] }) }),
  ),
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));
jest.mock("../../../src/modules/business_setup/webhooks.repo", () => ({
  findById: jest.fn(),
  markProcessed: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.service", () => ({
  recordInboundFromCustomer: jest.fn().mockResolvedValue({}),
  recordAgentReplyFromPlatform: jest.fn().mockResolvedValue({}),
  applyProviderStatus: jest.fn().mockResolvedValue(undefined),
  applyCustomerReaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({
  findMessagingAccount: jest.fn(),
  findContactBySocialHandle: jest.fn(),
  findContactByPhone: jest.fn(),
  findContactByEmail: jest.fn(),
  upsertSocialHandle: jest.fn().mockResolvedValue(undefined),
  createLeadContact: jest.fn(),
}));
jest.mock("../../../src/services/instagram.service", () => ({
  fetchUserProfile: jest.fn().mockResolvedValue(null),
}));

const webhookRepo = require("../../../src/modules/business_setup/webhooks.repo");
const service = require("../../../src/modules/smartcomm/smartcomm.service");
const smartcommRepo = require("../../../src/modules/smartcomm/smartcomm.repo");
const {
  onWebhookReceived,
} = require("../../../src/modules/smartcomm/smartcomm.subscribers");

function echoLog() {
  return {
    webhook_id: "w1",
    source: "meta_instagram",
    signature_valid: true,
    payload: {
      entry: [
        {
          id: "IG_BIZ_999",
          messaging: [
            {
              sender: { id: "IG_BIZ_999" },
              recipient: { id: "IGSID_CUST" },
              message: {
                mid: "m.echo1",
                text: "Sending the price list now ❤️",
                is_echo: true,
              },
            },
          ],
        },
      ],
    },
  };
}

describe("smartcomm webhook consumer — echo ingest + recovery bookkeeping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    webhookRepo.markProcessed.mockResolvedValue(undefined);
    smartcommRepo.findMessagingAccount.mockResolvedValue({
      business: "faitlynhair",
    });
    smartcommRepo.findContactBySocialHandle.mockResolvedValue({
      contact_id: "c-1",
      display_name: "Chef Mary",
    });
  });

  test("an Instagram app-reply echo is recorded as a business bubble and the row marked processed", async () => {
    webhookRepo.findById.mockResolvedValue(echoLog());

    await onWebhookReceived({ webhook_id: "w1", source: "meta_instagram" });

    expect(service.recordAgentReplyFromPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        contact_id: "c-1",
        platform: "instagram",
        external_ref: "m.echo1",
        external_thread_ref: "IGSID_CUST",
        body: "Sending the price list now ❤️",
      }),
    );
    expect(service.recordInboundFromCustomer).not.toHaveBeenCalled();
    expect(webhookRepo.markProcessed).toHaveBeenCalledWith("w1", {
      error_message: null,
    });
  });

  test("an ingest failure records the error on the log row AND rethrows for the outbox", async () => {
    webhookRepo.findById.mockResolvedValue(echoLog());
    service.recordAgentReplyFromPlatform.mockRejectedValue(
      new Error("channel_members_contact_id_fkey"),
    );

    await expect(
      onWebhookReceived({ webhook_id: "w1", source: "meta_instagram" }),
    ).rejects.toThrow("channel_members_contact_id_fkey");

    // The row now carries the failure — visible to diagnostics, and the
    // replay sweep (processed = false) can re-drive it after the outbox
    // gives up.
    expect(webhookRepo.markProcessed).toHaveBeenCalledWith("w1", {
      error_message: expect.stringContaining(
        "channel_members_contact_id_fkey",
      ),
    });
    expect(webhookRepo.markProcessed).not.toHaveBeenCalledWith("w1", {
      error_message: null,
    });
  });

  test("a customer DM still routes to recordInboundFromCustomer and marks processed", async () => {
    webhookRepo.findById.mockResolvedValue({
      webhook_id: "w2",
      source: "meta_instagram",
      signature_valid: true,
      payload: {
        entry: [
          {
            id: "IG_BIZ_999",
            messaging: [
              {
                sender: { id: "IGSID_CUST" },
                message: { mid: "m.cust1", text: "How much is this please" },
              },
            ],
          },
        ],
      },
    });

    await onWebhookReceived({ webhook_id: "w2", source: "meta_instagram" });

    expect(service.recordInboundFromCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        external_ref: "m.cust1",
        external_thread_ref: "IGSID_CUST",
      }),
    );
    expect(service.recordAgentReplyFromPlatform).not.toHaveBeenCalled();
    expect(webhookRepo.markProcessed).toHaveBeenCalledWith("w2", {
      error_message: null,
    });
  });

  test("an unverified payload is never processed and never marked", async () => {
    webhookRepo.findById.mockResolvedValue({
      webhook_id: "w3",
      source: "meta_instagram",
      signature_valid: false,
      payload: {},
    });

    await onWebhookReceived({ webhook_id: "w3", source: "meta_instagram" });

    expect(service.recordInboundFromCustomer).not.toHaveBeenCalled();
    expect(service.recordAgentReplyFromPlatform).not.toHaveBeenCalled();
    expect(webhookRepo.markProcessed).not.toHaveBeenCalled();
  });
});
