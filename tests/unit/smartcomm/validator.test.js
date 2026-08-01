"use strict";

const v = require("../../../src/modules/smartcomm/smartcomm.validator");

/**
 * Make a fake Express middleware harness so the validator behaves like
 * production code (body → req.body, next() to continue).
 */
function run(mw, body) {
  const req = { body };
  let calledNext = false;
  let error;
  try {
    mw(req, {}, () => {
      calledNext = true;
    });
  } catch (e) {
    error = e;
  }
  return { req, calledNext, error };
}

describe("smartcomm validators", () => {
  test("postMessage requires content or attachments", () => {
    const { error } = run(v.validatePostMessage, {});
    expect(error).toBeDefined();
  });

  test("postMessage accepts text-only", () => {
    const { calledNext, req } = run(v.validatePostMessage, {
      content: "hi",
      message_type: "text",
    });
    expect(calledNext).toBe(true);
    expect(req.body.content).toBe("hi");
  });

  test("postMessage accepts attachments-only", () => {
    const { calledNext } = run(v.validatePostMessage, {
      message_type: "image",
      attachments: [
        {
          document_id: "11111111-1111-1111-1111-111111111111",
          display_name: "x",
        },
      ],
    });
    expect(calledNext).toBe(true);
  });

  test("postMessage accepts a rich HTML email body (body_html only)", () => {
    const { calledNext } = run(v.validatePostMessage, {
      message_type: "text",
      subject: "Hello",
      body_html: "<p>Hi <strong>Ada</strong></p>",
    });
    expect(calledNext).toBe(true);
  });

  test("sendToCustomer requires a body on WhatsApp", () => {
    const { error } = run(v.validateSendToCustomer, {
      contact_id: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
    });
    expect(error).toBeDefined();
  });

  test("sendToCustomer allows email to lead with HTML + attachment (no plain body)", () => {
    const { calledNext } = run(v.validateSendToCustomer, {
      contact_id: "11111111-1111-1111-1111-111111111111",
      channel: "email",
      subject: "Your look",
      body_html: "<p>See the lookbook.</p>",
      attachments: [
        {
          document_id: "22222222-2222-2222-2222-222222222222",
          display_name: "lookbook.pdf",
        },
      ],
    });
    expect(calledNext).toBe(true);
  });

  test("quickReplyCreate enforces slug format", () => {
    const { error } = run(v.validateQuickReplyCreate, {
      scope: "personal",
      slug: "BadSlug With Spaces",
      title: "X",
      body: "Y",
    });
    expect(error).toBeDefined();
  });

  test("quickReplyCreate accepts valid input", () => {
    const { calledNext, req } = run(v.validateQuickReplyCreate, {
      scope: "personal",
      slug: "welcome",
      title: "Welcome",
      body: "Hi {{first_name}}, welcome to Pixie Girl ✨",
      variables: ["first_name"],
    });
    expect(calledNext).toBe(true);
    expect(req.body.slug).toBe("welcome");
  });

  test("muteChannel requires hours within range", () => {
    const { error } = run(v.validateMuteChannel, {
      muted: true,
      hours: 99999,
    });
    expect(error).toBeDefined();
  });

  test("forwardMessage rejects empty channel list", () => {
    const { error } = run(v.validateForwardMessage, { channel_ids: [] });
    expect(error).toBeDefined();
  });
});
