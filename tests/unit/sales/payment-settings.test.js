"use strict";

// Flexi Pay settings service (V2.2 §6.2 — owner session 2026-07-10).
// Pure-logic coverage: defaults merge, min-payment resolution, and the
// amount-allowed guard. DB-touching functions (getSettings/updateSettings)
// are exercised via mocked repos.

const { money } = require("../../../src/utils/money");

const mockConfig = {
  findByKey: jest.fn(),
};
jest.mock(
  "../../../src/modules/business_setup/business-config.repo",
  () => mockConfig,
);
jest.mock("../../../src/modules/business_setup/business-setup.repo", () => ({
  updateConfig: jest.fn(async () => ({})),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn(async () => {}),
}));
// publicConfig surfaces the brand's active NGN gateway chain (buyer-pickable
// rails for public checkout pages). Mocked — the real service validates env
// (ENCRYPTION_KEY etc.) at call time, which a hermetic unit test can't satisfy.
const mockGateways = {
  getActiveChain: jest.fn(async () => [
    { provider: "nomba", credentials: {} },
    { provider: "paystack", credentials: {} },
    { provider: "stripe", credentials: {} },
  ]),
};
jest.mock(
  "../../../src/modules/business_setup/payment-gateways.service",
  () => mockGateways,
);

const svc = require("../../../src/modules/sales/payment-settings.service");

describe("withDefaults", () => {
  it("fills every default when stored is empty", () => {
    const s = svc.withDefaults({});
    expect(s.plan_display_name).toBe("Flexi Pay");
    expect(s.min_first_payment_pct).toBe(30);
    expect(s.channels.storefront).toBe(true);
    expect(Array.isArray(s.plan_terms)).toBe(true);
  });

  it("stored values win over defaults, channels merge key-wise", () => {
    const s = svc.withDefaults({
      plan_display_name: "Pay Small Small",
      min_first_payment_pct: 25,
      channels: { sales_campaign: false },
    });
    expect(s.plan_display_name).toBe("Pay Small Small");
    expect(s.min_first_payment_pct).toBe(25);
    // Overridden channel off, untouched channels keep their default on.
    expect(s.channels.sales_campaign).toBe(false);
    expect(s.channels.storefront).toBe(true);
  });

  it("ignores a non-array plan_terms and falls back to the default", () => {
    const s = svc.withDefaults({ plan_terms: "nope" });
    expect(Array.isArray(s.plan_terms)).toBe(true);
    expect(s.plan_terms.length).toBeGreaterThan(0);
  });
});

describe("minNextPaymentNgn", () => {
  const settings = svc.withDefaults({
    min_first_payment_pct: 30,
    min_topup_ngn: 1000,
  });

  it("first payment on an instalment order = the locked deposit snapshot", () => {
    const order = {
      payment_plan: "instalment",
      total_ngn: "100000",
      amount_paid_ngn: "0",
      required_deposit_ngn: "30000",
    };
    expect(svc.minNextPaymentNgn(settings, order).toFixed(2)).toBe("30000.00");
  });

  it("first payment falls back to config pct when no snapshot (legacy order)", () => {
    const order = {
      payment_plan: "instalment",
      total_ngn: "100000",
      amount_paid_ngn: "0",
      required_deposit_ngn: null,
    };
    expect(svc.minNextPaymentNgn(settings, order).toFixed(2)).toBe("30000.00");
  });

  it("top-up uses the flat minimum once something is paid", () => {
    const order = {
      payment_plan: "instalment",
      total_ngn: "100000",
      amount_paid_ngn: "30000",
      required_deposit_ngn: "30000",
    };
    expect(svc.minNextPaymentNgn(settings, order).toFixed(2)).toBe("1000.00");
  });

  it("never demands more than the outstanding balance", () => {
    const order = {
      payment_plan: "instalment",
      total_ngn: "100000",
      amount_paid_ngn: "99500",
      required_deposit_ngn: "30000",
    };
    // Only ₦500 left — the ₦1,000 top-up floor is capped to the balance.
    expect(svc.minNextPaymentNgn(settings, order).toFixed(2)).toBe("500.00");
  });

  it("returns 0 when nothing is outstanding", () => {
    const order = {
      payment_plan: "instalment",
      total_ngn: "100000",
      amount_paid_ngn: "100000",
      required_deposit_ngn: "30000",
    };
    expect(svc.minNextPaymentNgn(settings, order).toFixed(2)).toBe("0.00");
  });
});

describe("assertPaymentAmountAllowed", () => {
  const settings = svc.withDefaults({
    min_first_payment_pct: 30,
    min_topup_ngn: 1000,
  });

  it("full-plan orders are exempt (always allowed)", () => {
    const order = {
      payment_plan: "full",
      total_ngn: "100000",
      amount_paid_ngn: "0",
    };
    expect(() =>
      svc.assertPaymentAmountAllowed({
        settings,
        order,
        amountNgn: money("1"),
      }),
    ).not.toThrow();
  });

  it("rejects a first instalment below the minimum", () => {
    const order = {
      payment_plan: "instalment",
      total_ngn: "100000",
      amount_paid_ngn: "0",
      required_deposit_ngn: "30000",
    };
    expect(() =>
      svc.assertPaymentAmountAllowed({
        settings,
        order,
        amountNgn: money("20000"),
      }),
    ).toThrow(/minimum/i);
  });

  it("allows the exact minimum and above", () => {
    const order = {
      payment_plan: "instalment",
      total_ngn: "100000",
      amount_paid_ngn: "0",
      required_deposit_ngn: "30000",
    };
    expect(() =>
      svc.assertPaymentAmountAllowed({
        settings,
        order,
        amountNgn: money("30000"),
      }),
    ).not.toThrow();
  });
});

describe("getSettings", () => {
  it("merges stored JSON over defaults + surfaces the manual-payment toggle", async () => {
    mockConfig.findByKey.mockResolvedValue({
      config_id: "cfg-1",
      installment_settings: { min_first_payment_pct: 40 },
      allow_staff_recorded_manual_payments: true,
    });
    const s = await svc.getSettings("pixiegirl");
    expect(s.min_first_payment_pct).toBe(40);
    expect(s.plan_display_name).toBe("Flexi Pay");
    expect(s.allow_staff_recorded_manual_payments).toBe(true);
  });
});

describe("publicConfig", () => {
  beforeEach(() => {
    mockConfig.findByKey.mockResolvedValue({
      config_id: "cfg-1",
      installment_settings: { channels: { sales_campaign: true } },
      allow_staff_recorded_manual_payments: false,
    });
  });

  it("exposes only checkout-safe fields", async () => {
    const c = await svc.publicConfig({
      brand: "pixiegirl",
      channel: "storefront",
    });
    expect(c).toHaveProperty("instalments_enabled", true);
    expect(c).toHaveProperty("plan_display_name");
    expect(c).toHaveProperty("min_first_payment_pct");
    expect(c).not.toHaveProperty("allow_staff_recorded_manual_payments");
  });

  it("exposes buyer-pickable gateways (names only, Stripe filtered out)", async () => {
    const c = await svc.publicConfig({
      brand: "pixiegirl",
      channel: "storefront",
    });
    // Stripe is a server-side last-resort, never a buyer-facing pick.
    expect(c.gateways).toEqual(["nomba", "paystack"]);
  });

  it("gateway lookup failure degrades to an empty list, never an error", async () => {
    mockGateways.getActiveChain.mockRejectedValueOnce(new Error("env"));
    const c = await svc.publicConfig({
      brand: "pixiegirl",
      channel: "storefront",
    });
    expect(c.gateways).toEqual([]);
  });

  it("campaign channel needs the campaign's own toggle on", async () => {
    const off = await svc.publicConfig({
      brand: "pixiegirl",
      channel: "sales_campaign",
      campaign: { allow_instalments: false },
    });
    expect(off.instalments_enabled).toBe(false);
    const on = await svc.publicConfig({
      brand: "pixiegirl",
      channel: "sales_campaign",
      campaign: { allow_instalments: true },
    });
    expect(on.instalments_enabled).toBe(true);
  });

  it("a disabled channel is not enabled even without a campaign", async () => {
    mockConfig.findByKey.mockResolvedValue({
      config_id: "cfg-1",
      installment_settings: { channels: { storefront: false } },
      allow_staff_recorded_manual_payments: false,
    });
    const c = await svc.publicConfig({
      brand: "pixiegirl",
      channel: "storefront",
    });
    expect(c.instalments_enabled).toBe(false);
  });
});
