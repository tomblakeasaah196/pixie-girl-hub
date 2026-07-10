"use strict";

/**
 * Unit tests for the inbound webhook parsers in smartcomm.subscribers.
 * These are pure functions over the provider payload shapes, so we can
 * test them without a DB.
 */

// The subscribers file calls register() at require-time and pulls in
// the outbox + sales events bus, which both depend on DB-backed
// modules. We jest-mock those so this unit test is hermetic.
jest.mock("../../../src/shared/outbox/outbox", () => ({
  register: jest.fn(),
}));
jest.mock("../../../src/modules/sales/sales.events", () => ({
  on: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(),
}));
jest.mock("../../../src/modules/business_setup/webhooks.repo", () => ({
  findById: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.service", () => ({
  sendToCustomer: jest.fn(),
  recordInboundFromCustomer: jest.fn(),
}));

const {
  parseMetaWhatsApp,
  parseMetaInstagram,
  parseCloudflareEmail,
} = require("../../../src/modules/smartcomm/smartcomm.subscribers");

describe("smartcomm webhook parsers", () => {
  test("parseMetaWhatsApp extracts a text message with contact metadata", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PHONE_ID_123" },
                contacts: [
                  { wa_id: "2348012345678", profile: { name: "Ada" } },
                ],
                messages: [
                  {
                    id: "wamid.AAA",
                    from: "2348012345678",
                    type: "text",
                    text: { body: "Hi! I want the body wave 18 inch." },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseMetaWhatsApp(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "whatsapp",
      external_account_id: "PHONE_ID_123",
      external_ref: "wamid.AAA",
      external_thread_ref: "2348012345678",
      message_type: "text",
      body: "Hi! I want the body wave 18 inch.",
    });
    expect(events[0].sender).toMatchObject({
      phone: "2348012345678",
      display_name: "Ada",
      external_user_id: "2348012345678",
    });
  });

  test("parseMetaInstagram ignores message echoes", () => {
    const payload = {
      entry: [
        {
          id: "IG_BIZ_999",
          messaging: [
            {
              sender: { id: "IGSID_1" },
              message: { mid: "m.1", text: "Hello!" },
            },
            {
              sender: { id: "IGSID_2" },
              message: { mid: "m.2", text: "echo", is_echo: true },
            },
          ],
        },
      ],
    };
    const events = parseMetaInstagram(payload);
    expect(events).toHaveLength(1);
    expect(events[0].external_account_id).toBe("IG_BIZ_999");
    expect(events[0].external_thread_ref).toBe("IGSID_1");
    expect(events[0].body).toBe("Hello!");
  });

  test("parseMetaInstagram routes a story mention as ig_story_mention", () => {
    const payload = {
      entry: [
        {
          id: "IG_BIZ_999",
          messaging: [
            {
              sender: { id: "IGSID_42" },
              message: {
                mid: "m.story",
                attachments: [
                  {
                    type: "story_mention",
                    payload: { url: "https://scontent.example/story.jpg" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseMetaInstagram(payload);
    expect(events).toHaveLength(1);
    expect(events[0].message_type).toBe("ig_story_mention");
    expect(events[0].metadata).toMatchObject({
      story_url: "https://scontent.example/story.jpg",
    });
  });

  test("parseMetaInstagram routes a reply-to-story as ig_story_reply", () => {
    const payload = {
      entry: [
        {
          id: "IG_BIZ_999",
          messaging: [
            {
              sender: { id: "IGSID_7" },
              message: {
                mid: "m.reply",
                text: "Love this!",
                reply_to: {
                  story: {
                    id: "story_abc",
                    url: "https://scontent.example/our-story.jpg",
                  },
                },
              },
            },
          ],
        },
      ],
    };
    const events = parseMetaInstagram(payload);
    expect(events).toHaveLength(1);
    expect(events[0].message_type).toBe("ig_story_reply");
    expect(events[0].body).toBe("Love this!");
    expect(events[0].metadata).toMatchObject({
      story_id: "story_abc",
      story_url: "https://scontent.example/our-story.jpg",
    });
  });

  test("parseCloudflareEmail strips HTML when text is absent", () => {
    const payload = {
      to: "support@pixiegirl.ng",
      from: { email: "buyer@example.com", name: "Test Buyer" },
      subject: "Re: Your order ORD-1234",
      html: "<p>Please <b>cancel</b> the order</p>",
      message_id: "<abc@buyer.example.com>",
      in_reply_to: "<def@hub.example.com>",
    };
    const events = parseCloudflareEmail(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "email",
      external_account_id: "support@pixiegirl.ng",
      external_ref: "<abc@buyer.example.com>",
      subject: "Re: Your order ORD-1234",
      in_reply_to: "<def@hub.example.com>",
    });
    expect(events[0].body).toBe("Please cancel the order");
    expect(events[0].sender).toMatchObject({
      email: "buyer@example.com",
      display_name: "Test Buyer",
    });
  });

  test("parseCloudflareEmail returns empty for malformed payload", () => {
    expect(parseCloudflareEmail({})).toEqual([]);
    expect(parseCloudflareEmail(null)).toEqual([]);
  });

  test("parseMetaWhatsApp handles image with caption + captures the media id", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PID" },
                contacts: [{ wa_id: "234801", profile: { name: "B" } }],
                messages: [
                  {
                    id: "wamid.IMG",
                    from: "234801",
                    type: "image",
                    image: {
                      id: "MEDIA_123",
                      mime_type: "image/jpeg",
                      caption: "What style is this?",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseMetaWhatsApp(payload);
    expect(events[0].body).toBe("What style is this?");
    expect(events[0].message_type).toBe("image");
    // The bytes aren't on the webhook — only the media id, which ingest
    // downloads. Capturing it is what fixes the blank "Photo" placeholder.
    expect(events[0].media).toMatchObject({
      kind: "image",
      media_id: "MEDIA_123",
      mime_type: "image/jpeg",
    });
  });

  test("parseMetaWhatsApp maps a voice note to voice_note with its media id", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PID" },
                contacts: [{ wa_id: "234801", profile: { name: "B" } }],
                messages: [
                  {
                    id: "wamid.AUD",
                    from: "234801",
                    type: "audio",
                    audio: { id: "AUD_9", mime_type: "audio/ogg", voice: true },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseMetaWhatsApp(payload);
    expect(events[0].message_type).toBe("voice_note");
    expect(events[0].media).toMatchObject({ kind: "audio", media_id: "AUD_9" });
  });

  test("parseMetaWhatsApp carries a document's filename through the media descriptor", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PID" },
                contacts: [{ wa_id: "234801", profile: { name: "B" } }],
                messages: [
                  {
                    id: "wamid.DOC",
                    from: "234801",
                    type: "document",
                    document: {
                      id: "DOC_5",
                      mime_type: "application/pdf",
                      filename: "receipt.pdf",
                      caption: "here you go",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseMetaWhatsApp(payload);
    expect(events[0].message_type).toBe("document");
    expect(events[0].body).toBe("here you go");
    expect(events[0].media).toMatchObject({
      kind: "document",
      media_id: "DOC_5",
      filename: "receipt.pdf",
    });
  });

  test("parseMetaWhatsApp leaves plain text messages without a media descriptor", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PID" },
                messages: [
                  { id: "wamid.T", from: "234801", type: "text", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseMetaWhatsApp(payload);
    expect(events[0].media).toBeNull();
  });
});
