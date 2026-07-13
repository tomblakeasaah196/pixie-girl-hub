"use strict";

/**
 * instagram-send processor — the link-button fallback.
 *
 * Meta bounces plain-text IG DMs that carry a raw URL with the opaque
 * "Invalid message id" (code 508 / subcode 2534122). The processor must
 * catch that specific failure, re-send the message as a button template
 * (prose as template text, URLs as web_url buttons), and only mark the
 * message failed when the template is rejected too.
 */

jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/services/storage.service", () => ({
  get: jest.fn(),
  put: jest.fn(),
  absoluteUrl: jest.fn(),
}));
jest.mock("../../../src/jobs/processors/media.ffmpeg", () => ({
  transcodeAudioToAac: jest.fn(),
}));
jest.mock("../../../src/services/instagram.service", () => ({
  isConfigured: jest.fn(async () => true),
  sendText: jest.fn(),
  sendMedia: jest.fn(),
  sendImage: jest.fn(),
  sendButtonTemplate: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.service", () => ({
  applyDeliveryResult: jest.fn(async () => ({})),
}));

const instagram = require("../../../src/services/instagram.service");
const smartcomm = require("../../../src/modules/smartcomm/smartcomm.service");
const process = require("../../../src/jobs/processors/instagram-processor");

function linkBounceError() {
  const err = new Error("Invalid message id — code 508 — subcode 2534122");
  err.meta_error = { code: 508, error_subcode: 2534122 };
  return err;
}

const BASE_JOB = {
  id: "job-1",
  data: {
    brand: "faitlynhair",
    recipient_id: "IGSID_1",
    smartcomm_message_id: "msg-1",
  },
};

const job = (extra) => ({ ...BASE_JOB, data: { ...BASE_JOB.data, ...extra } });

beforeEach(() => jest.clearAllMocks());

describe("instagram-send link-button fallback", () => {
  test("text with a URL bounced by 508 is re-sent as a button template", async () => {
    instagram.sendText.mockRejectedValueOnce(linkBounceError());
    instagram.sendButtonTemplate.mockResolvedValueOnce({ message_id: "mid.2" });

    const res = await process(
      job({ text: "Styling tips: https://youtu.be/abc — enjoy!" }),
    );

    expect(instagram.sendButtonTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        recipient_id: "IGSID_1",
        buttons: [
          { url: "https://youtu.be/abc", title: "Watch on YouTube" },
        ],
      }),
    );
    // The prose survives, minus the raw URL.
    const sent = instagram.sendButtonTemplate.mock.calls[0][0];
    expect(sent.text).toContain("Styling tips");
    expect(sent.text).not.toContain("https://youtu.be/abc");
    expect(res).toMatchObject({ mid: "mid.2", link_button_fallback: true });
    expect(smartcomm.applyDeliveryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: "msg-1",
        delivery_status: "sent",
        external_ref: "mid.2",
      }),
    );
  });

  test("passes the HUMAN_AGENT tag through to the fallback", async () => {
    instagram.sendText.mockRejectedValueOnce(linkBounceError());
    instagram.sendButtonTemplate.mockResolvedValueOnce({ message_id: "mid.3" });

    await process(job({ text: "form https://x.example/welcome/b/t", tag: "HUMAN_AGENT" }));

    expect(instagram.sendButtonTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "HUMAN_AGENT" }),
    );
  });

  test("a 508 on a text WITHOUT any URL does not trigger the fallback", async () => {
    instagram.sendText.mockRejectedValueOnce(linkBounceError());

    await expect(process(job({ text: "hello there" }))).rejects.toThrow(
      /Invalid message id/,
    );
    expect(instagram.sendButtonTemplate).not.toHaveBeenCalled();
    expect(smartcomm.applyDeliveryResult).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: "msg-1", delivery_status: "failed" }),
    );
  });

  test("a non-508 failure on a link message is not retried as a template", async () => {
    const err = new Error("Invalid OAuth access token");
    instagram.sendText.mockRejectedValueOnce(err);

    await expect(
      process(job({ text: "see https://youtu.be/abc" })),
    ).rejects.toThrow(/OAuth/);
    expect(instagram.sendButtonTemplate).not.toHaveBeenCalled();
  });

  test("when the template is rejected too, the message fails with a readable reason", async () => {
    instagram.sendText.mockRejectedValueOnce(linkBounceError());
    instagram.sendButtonTemplate.mockRejectedValueOnce(linkBounceError());

    await expect(
      process(job({ text: "see https://youtu.be/abc" })),
    ).rejects.toThrow();
    expect(smartcomm.applyDeliveryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: "msg-1",
        delivery_status: "failed",
        delivery_error: expect.stringMatching(/Instagram blocked the link/),
      }),
    );
  });

  test("a clean text send never touches the template path", async () => {
    instagram.sendText.mockResolvedValueOnce({ message_id: "mid.1" });
    const res = await process(job({ text: "hi https://youtu.be/abc" }));
    expect(res).toMatchObject({ mid: "mid.1" });
    expect(instagram.sendButtonTemplate).not.toHaveBeenCalled();
  });
});

describe("instagram-send multi-bubble sequence", () => {
  test("sends each step in order and stamps 'sent' only after the last one lands", async () => {
    instagram.sendMedia
      .mockResolvedValueOnce({ message_id: "mid.img.1" })
      .mockResolvedValueOnce({ message_id: "mid.img.2" });
    instagram.sendText
      .mockResolvedValueOnce({ message_id: "mid.name.1" })
      .mockResolvedValueOnce({ message_id: "mid.name.2" })
      .mockResolvedValueOnce({ message_id: "mid.link" });

    const sequence = [
      { image_url: "https://cdn/x/1.jpg" },
      { text: "*Teyena Taylor Light Grey*\nPrice: ₦435,000" },
      { image_url: "https://cdn/x/2.jpg" },
      { text: "*Teyena Taylor Dark Grey*\nPrice: ₦435,000" },
      { text: "🛍️ Order here: https://order.test/x" },
    ];

    const res = await process(job({ sequence }));

    // Every step ran; images and texts alternate as the composer emitted.
    const kinds = [
      ...instagram.sendMedia.mock.calls.map(() => "media"),
      ...instagram.sendText.mock.calls.map(() => "text"),
    ];
    expect(kinds).toHaveLength(sequence.length);
    // Delivery status flips exactly once, on the LAST provider mid.
    expect(smartcomm.applyDeliveryResult).toHaveBeenCalledTimes(1);
    expect(smartcomm.applyDeliveryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: "msg-1",
        delivery_status: "sent",
        external_ref: "mid.link",
      }),
    );
    expect(res).toMatchObject({ steps: sequence.length, mid: "mid.link" });
  });

  test("a mid-sequence failure marks the message failed and stops the send", async () => {
    instagram.sendMedia.mockResolvedValueOnce({ message_id: "mid.img.1" });
    instagram.sendText.mockRejectedValueOnce(
      Object.assign(new Error("Instagram: message is over 1000 characters"), {
        meta_error: { code: 100, error_subcode: 2534038 },
      }),
    );

    const sequence = [
      { image_url: "https://cdn/x/1.jpg" },
      { text: "long body that would be caption" },
      { image_url: "https://cdn/x/2.jpg" },
      { text: "🛍️ Order here" },
    ];

    await expect(process(job({ sequence }))).rejects.toThrow(/1000 characters/);
    // Third + fourth steps never fire.
    expect(instagram.sendMedia).toHaveBeenCalledTimes(1);
    expect(smartcomm.applyDeliveryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: "msg-1",
        delivery_status: "failed",
      }),
    );
  });
});
