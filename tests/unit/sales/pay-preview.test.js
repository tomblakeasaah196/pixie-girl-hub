"use strict";

// Flexi Pay pay-page contract (PR-2): previewByToken returns every figure the
// /pay/{token} page renders — plan, terms, balance, minimum next payment, the
// display FX rate, and the captured-payment history. The page does no money
// math of its own, so this shape is load-bearing.

const mockRepo = {
  findByPublicToken: jest.fn(),
  listPayments: jest.fn(),
};
const mockSettings = {
  getSettings: jest.fn(),
  minNextPaymentNgn: jest.fn(),
};

jest.mock("../../../src/modules/sales/sales.repo", () => mockRepo);
jest.mock(
  "../../../src/modules/sales/payment-settings.service",
  () => mockSettings,
);
jest.mock("../../../src/modules/sales_campaigns/campaigns.repo", () => ({}));
jest.mock(
  "../../../src/modules/business_setup/payment-gateways.service",
  () => ({}),
);
jest.mock("../../../src/services/paystack.service", () => ({}));
jest.mock("../../../src/services/opay.service", () => ({}));
jest.mock("../../../src/services/nomba.service", () => ({}));
jest.mock("../../../src/services/stripe.service", () => ({}));
jest.mock("../../../src/services/currency.service", () => ({
  SETTLEMENT_CURRENCIES: ["NGN", "USD"],
}));
jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/brands", () => ({
  VALID: new Set(["pixiegirl", "faitlynhair"]),
}));
jest.mock("../../../src/utils/brand-urls", () => ({
  payLinkUrl: jest.fn(async (b, t) => `https://sales.example.com/pay/${t}`),
}));

const { money } = require("../../../src/utils/money");
const paymentLink = require("../../../src/modules/sales/payment-link.service");

const ORDER = {
  order_id: "ord-1",
  order_number: "FLH-SO-0102",
  status: "pending_payment",
  payment_plan: "instalment",
  total_ngn: "150000.00",
  amount_paid_ngn: "45000.00",
  required_deposit_ngn: "45000.00",
  display_currency: "USD",
  fx_rate_used: "1300",
};

beforeEach(() => {
  jest.clearAllMocks();
  // Order lives on the faitlynhair brand — resolveByToken finds it on the
  // second brand, proving the cross-brand lookup.
  mockRepo.findByPublicToken.mockImplementation(async ({ brand }) =>
    brand === "faitlynhair" ? ORDER : null,
  );
  mockSettings.getSettings.mockResolvedValue({
    plan_display_name: "Flexi Pay",
    plan_terms: ["Reserved for you", "Ships when fully paid"],
  });
  mockSettings.minNextPaymentNgn.mockReturnValue(money("1000"));
  mockRepo.listPayments.mockResolvedValue([
    {
      payment_number: "FLH-PAY-1",
      amount_ngn: "45000.00",
      method: "paystack_card",
      status: "captured",
      captured_at: "2026-07-01T10:00:00Z",
    },
    // A failed attempt must NOT appear in the history.
    {
      payment_number: "FLH-PAY-2",
      amount_ngn: "10000.00",
      method: "paystack_card",
      status: "failed",
      captured_at: null,
    },
  ]);
});

describe("previewByToken", () => {
  it("returns the full plan + balance + rate + history shape", async () => {
    const p = await paymentLink.previewByToken({ token: "tok-abc" });
    expect(p.brand).toBe("faitlynhair");
    expect(p.order_number).toBe("FLH-SO-0102");
    expect(p.payment_plan).toBe("instalment");
    expect(p.plan_display_name).toBe("Flexi Pay");
    expect(p.plan_terms).toEqual(["Reserved for you", "Ships when fully paid"]);
    expect(p.total_ngn).toBe("150000.00");
    expect(p.amount_paid_ngn).toBe("45000.00");
    expect(p.outstanding_ngn).toBe("105000.00");
    expect(p.min_next_payment_ngn).toBe("1000.00");
    // USD display rate locked at placement.
    expect(p.display_currency).toBe("USD");
    expect(p.display_fx_rate).toBe(1300);
    // The $ the pay page shows and charges: ₦105,000 ÷ 1,300 = $80.77, and
    // the ₦1,000 minimum rounded UP to the cent ($0.77).
    expect(p.outstanding_usd).toBe("80.77");
    expect(p.min_next_payment_usd).toBe("0.77");
  });

  it("a Naira order carries no dollar fields", async () => {
    mockRepo.findByPublicToken.mockImplementation(async ({ brand }) =>
      brand === "faitlynhair"
        ? { ...ORDER, display_currency: "NGN", fx_rate_used: "1.000000" }
        : null,
    );
    const p = await paymentLink.previewByToken({ token: "tok-abc" });
    expect(p.outstanding_usd).toBeUndefined();
  });

  it("lists only captured payments", async () => {
    const p = await paymentLink.previewByToken({ token: "tok-abc" });
    expect(p.payments).toHaveLength(1);
    expect(p.payments[0].payment_number).toBe("FLH-PAY-1");
    expect(p.payments[0].amount_ngn).toBe("45000.00");
  });

  it("clamps a negative outstanding to zero", async () => {
    mockRepo.findByPublicToken.mockImplementation(async ({ brand }) =>
      brand === "faitlynhair"
        ? { ...ORDER, amount_paid_ngn: "160000.00" }
        : null,
    );
    const p = await paymentLink.previewByToken({ token: "tok-abc" });
    expect(p.outstanding_ngn).toBe("0.00");
  });

  it("throws when the token resolves to no order", async () => {
    mockRepo.findByPublicToken.mockResolvedValue(null);
    await expect(
      paymentLink.previewByToken({ token: "nope" }),
    ).rejects.toThrow();
  });
});
