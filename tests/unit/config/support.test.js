"use strict";

const { getSupportContact, supportSentence } = require("../../../src/config/support");

describe("support contact resolver", () => {
  test("faitlynhair has the owner-provided WhatsApp line", () => {
    const c = getSupportContact("faitlynhair");
    expect(c.whatsapp).toBe("+2348061987874");
    expect(supportSentence(c)).toContain("+2348061987874");
    expect(supportSentence(c)).toContain("WhatsApp");
  });

  test("reads support_email + display_name from a business_config row", () => {
    const c = getSupportContact("pixiegirl", {
      support_email: "support@pixiegirlglobal.com",
      display_name: "Pixie Girl",
    });
    expect(c.email).toBe("support@pixiegirlglobal.com");
    expect(c.brand_name).toBe("Pixie Girl");
    expect(supportSentence(c)).toContain("Pixie Girl");
  });

  test("env override wins for the WhatsApp number", () => {
    const prev = process.env.PIXIEGIRL_SUPPORT_WHATSAPP;
    process.env.PIXIEGIRL_SUPPORT_WHATSAPP = "+2348000000000";
    try {
      expect(getSupportContact("pixiegirl").whatsapp).toBe("+2348000000000");
    } finally {
      if (prev === undefined) delete process.env.PIXIEGIRL_SUPPORT_WHATSAPP;
      else process.env.PIXIEGIRL_SUPPORT_WHATSAPP = prev;
    }
  });

  test("always returns a usable sentence even with nothing configured", () => {
    const c = getSupportContact("pixiegirl");
    expect(typeof supportSentence(c)).toBe("string");
    expect(supportSentence(c).length).toBeGreaterThan(0);
  });
});
