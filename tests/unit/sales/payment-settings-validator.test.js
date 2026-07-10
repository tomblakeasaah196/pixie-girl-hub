"use strict";

const {
  settingsPatch,
} = require("../../../src/modules/sales/payment-settings.validator");

describe("payment-settings validator", () => {
  it("accepts a partial patch", () => {
    const v = settingsPatch.parse({ min_first_payment_pct: 25 });
    expect(v.min_first_payment_pct).toBe(25);
  });

  it("accepts the manual-payment toggle", () => {
    const v = settingsPatch.parse({
      allow_staff_recorded_manual_payments: true,
    });
    expect(v.allow_staff_recorded_manual_payments).toBe(true);
  });

  it("accepts a channels map", () => {
    const v = settingsPatch.parse({
      channels: { storefront: false, walk_in: true },
    });
    expect(v.channels.storefront).toBe(false);
  });

  it("rejects an out-of-range percentage", () => {
    expect(() => settingsPatch.parse({ min_first_payment_pct: 150 })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => settingsPatch.parse({ wat: 1 })).toThrow();
  });

  it("rejects an unknown channel key", () => {
    expect(() => settingsPatch.parse({ channels: { tiktok: true } })).toThrow();
  });

  it("rejects an empty plan_terms array", () => {
    expect(() => settingsPatch.parse({ plan_terms: [] })).toThrow();
  });
});
