"use strict";

const v = require("../../../src/modules/messaging_accounts/messaging-accounts.validator");

function run(mw, body) {
  const req = { body };
  let called = false;
  let error;
  try {
    mw(req, {}, () => {
      called = true;
    });
  } catch (e) {
    error = e;
  }
  return { req, called, error };
}

describe("messaging_accounts validator", () => {
  test("accepts a WhatsApp connection with full payload", () => {
    const { called, req } = run(v.validateUpsert, {
      platform: "whatsapp",
      external_account_id: "105937284732910",
      display_name: "Pixie Girl Care",
      access_token: "EAAStartsWithEAA…",
      webhook_verify_token: "some-random-string",
      is_active: true,
    });
    expect(called).toBe(true);
    expect(req.body.platform).toBe("whatsapp");
  });

  test("accepts an email mailbox (no access_token required)", () => {
    const { called } = run(v.validateUpsert, {
      platform: "email",
      external_account_id: "support@pixiegirlglobal.com",
      display_name: "Pixie Girl Support",
    });
    expect(called).toBe(true);
  });

  test("rejects unsupported platforms", () => {
    const { error } = run(v.validateUpsert, {
      platform: "wechat",
      external_account_id: "x",
      display_name: "y",
    });
    expect(error).toBeDefined();
  });

  test("rejects missing display_name", () => {
    const { error } = run(v.validateUpsert, {
      platform: "instagram",
      external_account_id: "17841405822304914",
    });
    expect(error).toBeDefined();
  });

  test("rejects oversize access_token", () => {
    // Cap widened to 4000 in 000289 to fit Meta system-user tokens.
    const { error } = run(v.validateUpsert, {
      platform: "whatsapp",
      external_account_id: "1",
      display_name: "x",
      access_token: "A".repeat(5000),
    });
    expect(error).toBeDefined();
  });

  test("setActive requires boolean", () => {
    const { error } = run(v.validateSetActive, { is_active: "yes" });
    expect(error).toBeDefined();
    const { called } = run(v.validateSetActive, { is_active: true });
    expect(called).toBe(true);
  });

  describe("whatsapp profile", () => {
    test("accepts a partial profile update", () => {
      const { called, req } = run(v.validateWhatsAppProfile, {
        about: "Premium hair & beauty",
        vertical: "RETAIL",
        websites: ["https://pixiegirlglobal.com"],
      });
      expect(called).toBe(true);
      expect(req.body.vertical).toBe("RETAIL");
    });

    test("allows clearing text fields with empty strings", () => {
      const { called } = run(v.validateWhatsAppProfile, {
        about: "",
        email: "",
      });
      expect(called).toBe(true);
    });

    test("rejects an empty update", () => {
      const { error } = run(v.validateWhatsAppProfile, {});
      expect(error).toBeDefined();
    });

    test("rejects an over-length about (>139)", () => {
      const { error } = run(v.validateWhatsAppProfile, {
        about: "a".repeat(140),
      });
      expect(error).toBeDefined();
    });

    test("rejects an unknown vertical", () => {
      const { error } = run(v.validateWhatsAppProfile, { vertical: "SPACESHIPS" });
      expect(error).toBeDefined();
    });

    test("rejects an invalid email", () => {
      const { error } = run(v.validateWhatsAppProfile, { email: "not-an-email" });
      expect(error).toBeDefined();
    });

    test("rejects more than two websites", () => {
      const { error } = run(v.validateWhatsAppProfile, {
        websites: ["https://a.com", "https://b.com", "https://c.com"],
      });
      expect(error).toBeDefined();
    });

    test("rejects unknown keys (strict)", () => {
      const { error } = run(v.validateWhatsAppProfile, {
        about: "hi",
        profile_picture_handle: "malicious",
      });
      expect(error).toBeDefined();
    });
  });
});
