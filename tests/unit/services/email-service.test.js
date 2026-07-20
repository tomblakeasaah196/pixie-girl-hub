"use strict";

/**
 * email.service.send — Cc + attachment resolution.
 *
 * The messaging composer hands the email processor a Cc list and stored-file
 * references (storage KEYS, never bytes — those would bloat the Redis job).
 * send() must pass Cc straight through to Nodemailer and load each stored
 * file's bytes at send time. A missing file fails loudly rather than sending
 * a mail silently missing the promised PDF/photo.
 */

const mockSendMail = jest.fn(async () => ({ messageId: "msg-1" }));

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
    verify: jest.fn(async () => true),
  })),
}));

jest.mock("../../../src/config/database", () => ({
  // getSender()'s business_config lookup — no per-brand override here.
  query: jest.fn(async () => ({ rows: [] })),
}));

const mockStorageGet = jest.fn();
jest.mock("../../../src/services/storage.service", () => ({
  get: (...args) => mockStorageGet(...args),
}));

// A configured default relay so getSender resolves a From address.
jest.mock("../../../src/config/env", () => ({
  config: {
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: 587,
    SMTP_USER: "relay@example.com",
    SMTP_PASSWORD: "secret",
    SMTP_FROM_EMAIL: "hello@example.com",
    SMTP_FROM_NAME: "Test Brand",
    NODE_ENV: "test",
  },
}));

const email = require("../../../src/services/email.service");

beforeEach(() => {
  jest.clearAllMocks();
});

test("passes a Cc array through to Nodemailer", async () => {
  await email.send({
    to: "buyer@example.com",
    cc: ["a@example.com", "b@example.com"],
    subject: "Hi",
    html: "<p>hi</p>",
  });
  expect(mockSendMail).toHaveBeenCalledTimes(1);
  expect(mockSendMail.mock.calls[0][0].cc).toEqual(["a@example.com", "b@example.com"]);
});

test("omits Cc entirely when the list is empty", async () => {
  await email.send({ to: "buyer@example.com", cc: [], subject: "Hi", html: "<p>hi</p>" });
  expect(mockSendMail.mock.calls[0][0].cc).toBeUndefined();
});

test("loads stored-file attachments by key and passes buffers to Nodemailer", async () => {
  mockStorageGet.mockResolvedValueOnce(Buffer.from("PDFBYTES"));
  await email.send({
    to: "buyer@example.com",
    subject: "Invoice",
    html: "<p>see attached</p>",
    attachments: [
      { filename: "invoice.pdf", storage_key: "docs/invoice.pdf", content_type: "application/pdf" },
    ],
  });
  expect(mockStorageGet).toHaveBeenCalledWith("docs/invoice.pdf");
  const sent = mockSendMail.mock.calls[0][0];
  expect(sent.attachments).toHaveLength(1);
  expect(sent.attachments[0].filename).toBe("invoice.pdf");
  expect(sent.attachments[0].contentType).toBe("application/pdf");
  expect(Buffer.isBuffer(sent.attachments[0].content)).toBe(true);
  expect(sent.attachments[0].content.toString()).toBe("PDFBYTES");
});

test("passes ready Nodemailer attachment objects through untouched", async () => {
  await email.send({
    to: "buyer@example.com",
    subject: "Hi",
    html: "<p>hi</p>",
    attachments: [{ filename: "note.txt", content: "inline" }],
  });
  expect(mockStorageGet).not.toHaveBeenCalled();
  expect(mockSendMail.mock.calls[0][0].attachments).toEqual([
    { filename: "note.txt", content: "inline" },
  ]);
});

test("resolveSenderIdentity exposes the From + conversational Reply-To the send resolves", async () => {
  // This is the identity email marketing shows read-only and sends with — no
  // per-campaign entry. With the default relay it falls to SMTP_FROM_* and the
  // sales@<domain> reply-to, exactly what the live send would use.
  const identity = await email.resolveSenderIdentity();
  expect(identity).toEqual({
    from_name: "Test Brand",
    from_email: "hello@example.com",
    reply_to: "sales@example.com",
  });
});

test("throws a clear error (does not send) when a stored file is missing", async () => {
  mockStorageGet.mockRejectedValueOnce(new Error("ENOENT"));
  await expect(
    email.send({
      to: "buyer@example.com",
      subject: "Invoice",
      html: "<p>x</p>",
      attachments: [{ filename: "gone.pdf", storage_key: "docs/gone.pdf" }],
    }),
  ).rejects.toMatchObject({ code: "EMAIL_ATTACHMENT_MISSING" });
  expect(mockSendMail).not.toHaveBeenCalled();
});
