"use strict";

/**
 * buildOutboundJobsForChannel — Instagram recipient resolution.
 *
 * IGSIDs are scoped per IG business account: the id that opened the
 * thread (channel.external_thread_ref, stamped by the inbound webhook)
 * is the only recipient Meta accepts on that brand's token. Sending to
 * a contact-level handle from another brand (or a form-typed username)
 * is bounced with the opaque "Invalid message id" (508 / 2534122) —
 * the bug that made links and voice notes fail while the 24h window
 * was open. These tests pin the resolution order.
 */

jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({
  setMessageDelivery: jest.fn(async () => ({})),
  getAttachmentsForSend: jest.fn(async () => []),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));
jest.mock("../../../src/jobs/queue-producer", () => ({
  enqueue: jest.fn(async () => ({})),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn(async () => {}),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(async () => ({ rows: [] })),
  ex: jest.fn(),
}));
jest.mock("../../../src/services/storage.service", () => ({
  absoluteUrl: jest.fn((key) => `https://hub.example.com/media/${key}`),
  publicUrl: jest.fn((key) => `/media/${key}`),
}));

const { ex } = require("../../../src/config/database");
const repo = require("../../../src/modules/smartcomm/smartcomm.repo");
const service = require("../../../src/modules/smartcomm/smartcomm.service");

const FUTURE = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 12 * 3600 * 1000).toISOString();

function igChannel(overrides = {}) {
  return {
    channel_id: "ch-1",
    channel_type: "customer_thread",
    business: "faitlynhair",
    external_platform: "instagram",
    external_thread_ref: "IGSID_THREAD",
    ig_window_expires_at: FUTURE,
    metadata: {},
    ...overrides,
  };
}

function textMessage(overrides = {}) {
  return { message_id: "m-1", message_type: "text", ...overrides };
}

/** Stub the member/handle lookup that rides ex(client). */
function stubMember(row) {
  ex.mockReturnValue(jest.fn(async () => ({ rows: row ? [row] : [] })));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("instagram recipient resolution", () => {
  test("prefers the thread's own IGSID over the contact-level handle", async () => {
    stubMember({ contact_id: "c-1", ig_user_id: "IGSID_OTHER_BRAND" });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: igChannel(),
      message: textMessage(),
      content: "Welcome 🌹 https://hub.example.com/welcome/faitlynhair/tok",
      client: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].queue).toBe("instagram-send");
    expect(jobs[0].data.recipient_id).toBe("IGSID_THREAD");
    expect(jobs[0].data.tag).toBeUndefined(); // window open → free-form
  });

  test("falls back to the contact handle when the thread has no ref", async () => {
    stubMember({ contact_id: "c-1", ig_user_id: "IGSID_CONTACT" });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: igChannel({ external_thread_ref: null }),
      message: textMessage(),
      content: "hello",
      client: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.recipient_id).toBe("IGSID_CONTACT");
  });

  test("fails the message when no recipient id exists anywhere", async () => {
    stubMember({ contact_id: "c-1", ig_user_id: null });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: igChannel({ external_thread_ref: null }),
      message: textMessage(),
      content: "hello",
      client: {},
    });
    expect(jobs).toEqual([]);
    expect(repo.setMessageDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: "m-1",
        delivery_status: "failed",
        delivery_error: "NO_IG_HANDLE_ON_FILE",
      }),
    );
  });

  test("tags HUMAN_AGENT only when the window is expired", async () => {
    stubMember({ contact_id: "c-1", ig_user_id: null });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: igChannel({ ig_window_expires_at: PAST }),
      message: textMessage(),
      content: "hello again",
      client: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.recipient_id).toBe("IGSID_THREAD");
    expect(jobs[0].data.tag).toBe("HUMAN_AGENT");
  });

  test("voice notes ride the thread IGSID and carry transcode hints", async () => {
    stubMember({ contact_id: "c-1", ig_user_id: "IGSID_OTHER_BRAND" });
    repo.getAttachmentsForSend.mockResolvedValueOnce([
      {
        file_path: "docs/note.webm",
        mime_type: "audio/webm",
        display_name: "note.webm",
      },
    ]);
    const jobs = await service.buildOutboundJobsForChannel({
      channel: igChannel(),
      message: textMessage({ message_type: "voice_note" }),
      content: null,
      client: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.recipient_id).toBe("IGSID_THREAD");
    expect(jobs[0].data.media_kind).toBe("audio");
    expect(jobs[0].data.media_key).toBe("docs/note.webm");
    expect(jobs[0].data.source_mime).toBe("audio/webm");
    expect(jobs[0].data.media_url).toBe(
      "https://hub.example.com/media/docs/note.webm",
    );
  });
});

// ── Email: branding, subject, Cc, attachments ─────────────
function emailChannel(overrides = {}) {
  return {
    channel_id: "ch-email",
    channel_type: "customer_thread",
    business: "faitlynhair",
    external_platform: "email",
    metadata: {},
    ...overrides,
  };
}

describe("email outbound", () => {
  test("brands the body, defaults the subject, no cc/attachments", async () => {
    stubMember({ contact_id: "c-1", email: "buyer@example.com" });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: emailChannel(),
      message: textMessage(),
      content: "Hi there,\n\nYour order ships tomorrow.",
      client: {},
    });
    expect(jobs).toHaveLength(1);
    const { data } = jobs[0];
    expect(jobs[0].queue).toBe("email-send");
    expect(data.to).toBe("buyer@example.com");
    expect(data.subject).toBe("A message from us");
    expect(data.cc).toBeUndefined();
    expect(data.attachments).toBeUndefined();
    // Branded: wrapped in the house HTML shell, not a bare string.
    expect(data.html).toMatch(/<!DOCTYPE html>/i);
    expect(data.html).toContain("Your order ships tomorrow.");
    // Plain-text alternative keeps the readable body.
    expect(data.text).toContain("Your order ships tomorrow.");
  });

  test("uses the per-message subject and cleans the Cc list", async () => {
    stubMember({ contact_id: "c-1", email: "buyer@example.com" });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: emailChannel({ metadata: { subject: "Old thread subject" } }),
      message: textMessage({
        metadata: {
          subject: "Your July invoice",
          cc: ["Accounts@Example.com", "bad", "accounts@example.com"],
        },
      }),
      content: "Please find your invoice.",
      client: {},
    });
    expect(jobs).toHaveLength(1);
    const { data } = jobs[0];
    expect(data.subject).toBe("Your July invoice");
    // Lower-cased + de-duplicated + invalid dropped.
    expect(data.cc).toEqual(["accounts@example.com"]);
  });

  test("falls back to the thread subject when the message has none", async () => {
    stubMember({ contact_id: "c-1", email: "buyer@example.com" });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: emailChannel({ metadata: { subject: "Re: Your enquiry" } }),
      message: textMessage(),
      content: "Thanks for reaching out.",
      client: {},
    });
    expect(jobs[0].data.subject).toBe("Re: Your enquiry");
  });

  test("attaches stored files as storage keys (not bytes)", async () => {
    stubMember({ contact_id: "c-1", email: "buyer@example.com" });
    repo.getAttachmentsForSend.mockResolvedValueOnce([
      { file_path: "docs/invoice.pdf", mime_type: "application/pdf", display_name: "invoice.pdf" },
      { file_path: "docs/look.jpg", mime_type: "image/jpeg", display_name: "look.jpg" },
    ]);
    const jobs = await service.buildOutboundJobsForChannel({
      channel: emailChannel(),
      message: textMessage({ message_type: "document" }),
      content: "Documents attached.",
      client: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.attachments).toEqual([
      { filename: "invoice.pdf", storage_key: "docs/invoice.pdf", content_type: "application/pdf" },
      { filename: "look.jpg", storage_key: "docs/look.jpg", content_type: "image/jpeg" },
    ]);
  });

  test("still sends an attachment-only email (empty body)", async () => {
    stubMember({ contact_id: "c-1", email: "buyer@example.com" });
    repo.getAttachmentsForSend.mockResolvedValueOnce([
      { file_path: "docs/receipt.pdf", mime_type: "application/pdf", display_name: "receipt.pdf" },
    ]);
    const jobs = await service.buildOutboundJobsForChannel({
      channel: emailChannel(),
      message: textMessage({ message_type: "document" }),
      content: null,
      client: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.attachments).toHaveLength(1);
  });

  test("fails the message when body and attachments are both empty", async () => {
    stubMember({ contact_id: "c-1", email: "buyer@example.com" });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: emailChannel(),
      message: textMessage(),
      content: "   ",
      client: {},
    });
    expect(jobs).toEqual([]);
    expect(repo.setMessageDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: "m-1",
        delivery_status: "failed",
        delivery_error: "NOTHING_TO_SEND",
      }),
    );
  });

  test("fails the message when the contact has no email on file", async () => {
    stubMember({ contact_id: "c-1", email: null });
    const jobs = await service.buildOutboundJobsForChannel({
      channel: emailChannel(),
      message: textMessage(),
      content: "hello",
      client: {},
    });
    expect(jobs).toEqual([]);
    expect(repo.setMessageDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_error: "NO_EMAIL_ON_FILE",
      }),
    );
  });
});
