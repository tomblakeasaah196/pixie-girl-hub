"use strict";

// Quotation pay-link rail (000090).
//
// A quotation can now be paid directly: the gateway checkout carries
// metadata.quotation_id (NOT order_id, because no order exists yet), and the
// inbound webhook converts the quote into a sales order at the moment of
// confirmation. These tests pin the two halves that make that safe:
//   1. the checkout is raised with quotation_id in metadata, at the quote's own
//      settlement currency and locked rate;
//   2. only a live, unconverted, unexpired quote can be paid.

const DAY = 24 * 60 * 60 * 1000;

const QUOTE_NGN = {
  quotation_id: "quo-ngn",
  quotation_number: "PXG-QUO-0001",
  status: "sent",
  contact_id: "contact-1",
  total_ngn: "250000.00",
  display_currency: null,
  fx_rate_used: null,
  valid_until: null,
  lines: [],
};

const QUOTE_USD = {
  ...QUOTE_NGN,
  quotation_id: "quo-usd",
  quotation_number: "FLH-QUO-0007",
  total_ngn: "992400.00",
  display_currency: "USD",
  fx_rate_used: "1300", // ₦992,400 ÷ 1,300 = $763.38
  display_total: "764.00", // the dollar figure the quote showed
};

let mockQuote = QUOTE_NGN;
let mockProvider = "nomba";
const mockNombaCalls = [];
const mockPaystackCalls = [];
const mockChainCalls = [];

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(async () => null),
  findByPublicToken: jest.fn(async () => null),
  findByOrderNumber: jest.fn(async () => null),
  findQuotationById: jest.fn(async () => mockQuote),
  findQuotationByPayToken: jest.fn(async () => null),
  ensureQuotationPayToken: jest.fn(async () => "tok-abc"),
}));

jest.mock("../../../src/modules/sales_campaigns/campaigns.repo", () => ({
  findById: jest.fn(async () => null),
}));

jest.mock(
  "../../../src/modules/business_setup/payment-gateways.service",
  () => ({
    getActiveChain: jest.fn(async ({ currency }) => {
      mockChainCalls.push(currency);
      return [{ provider: mockProvider, credentials: { client_id: "c" } }];
    }),
  }),
);

jest.mock("../../../src/services/nomba.service", () => ({
  initializePayment: jest.fn(async (args) => {
    mockNombaCalls.push(args);
    return { data: { checkoutLink: "https://pay.nomba.com/checkout/xyz" } };
  }),
}));

jest.mock("../../../src/services/paystack.service", () => ({
  initializeTransaction: jest.fn(async (args) => {
    mockPaystackCalls.push(args);
    return { data: { authorization_url: "https://checkout.paystack.com/xyz" } };
  }),
}));
jest.mock("../../../src/services/opay.service", () => ({}));
jest.mock("../../../src/services/stripe.service", () => ({}));

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async () => ({ rows: [{ email: "buyer@example.com" }] })),
}));

jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "https://hub.example.com" },
}));

const paymentLink = require("../../../src/modules/sales/payment-link.service");

beforeEach(() => {
  mockNombaCalls.length = 0;
  mockPaystackCalls.length = 0;
  mockChainCalls.length = 0;
  mockQuote = QUOTE_NGN;
  mockProvider = "nomba";
});

describe("createQuotationPaymentLink", () => {
  test("checkout metadata carries quotation_id — and no order_id", async () => {
    // Paystack (like OPay/Stripe) receives real metadata; this is what the
    // webhook keys off to decide "convert first, then record".
    mockProvider = "paystack";
    const res = await paymentLink.createQuotationPaymentLink({
      brand: "pixiegirl",
      quotation_id: QUOTE_NGN.quotation_id,
    });

    expect(res.checkout_url).toBe("https://checkout.paystack.com/xyz");
    expect(mockPaystackCalls).toHaveLength(1);
    expect(mockPaystackCalls[0].metadata).toMatchObject({
      brand: "pixiegirl",
      quotation_id: QUOTE_NGN.quotation_id,
      amount_ngn: "250000.00",
    });
    // No order exists yet — an order_id here would make the webhook try to
    // record against a row that isn't there.
    expect(mockPaystackCalls[0].metadata.order_id).toBeUndefined();
  });

  test("Nomba reference embeds the quote number (its only identifier)", async () => {
    // Nomba's checkout API accepts NO metadata — just orderReference — so the
    // quote number in the reference is the sole way its webhook can resolve the
    // document. webhooks.service parses `nomba-<doc_number>-<ts>` back out.
    const res = await paymentLink.createQuotationPaymentLink({
      brand: "pixiegirl",
      quotation_id: QUOTE_NGN.quotation_id,
    });
    expect(res.reference).toMatch(/^nomba-PXG-QUO-0001-[a-z0-9]+$/);
    expect(mockNombaCalls).toHaveLength(1);
  });

  test("charges the FULL quote total in Naira", async () => {
    await paymentLink.createQuotationPaymentLink({
      brand: "pixiegirl",
      quotation_id: QUOTE_NGN.quotation_id,
    });
    expect(mockNombaCalls[0].currency).toBe("NGN");
    expect(mockNombaCalls[0].amount).toBe("250000.00");
    expect(mockChainCalls).toContain("NGN");
  });

  test("USD quote settles in USD at the rate locked on the quote", async () => {
    mockQuote = QUOTE_USD;
    await paymentLink.createQuotationPaymentLink({
      brand: "faitlynhair",
      quotation_id: QUOTE_USD.quotation_id,
    });
    // Same locked-rate rule as an order: the buyer is charged the figure the
    // quote showed them, never a live rate.
    expect(mockNombaCalls[0].currency).toBe("USD");
    expect(mockNombaCalls[0].amount).toBe("764.00");
    expect(mockChainCalls).toContain("USD");
  });

  test("an already-converted quote cannot be paid twice", async () => {
    mockQuote = { ...QUOTE_NGN, status: "converted" };
    await expect(
      paymentLink.createQuotationPaymentLink({
        brand: "pixiegirl",
        quotation_id: QUOTE_NGN.quotation_id,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_CONVERTED" });
    expect(mockNombaCalls).toHaveLength(0);
  });

  test("a draft quote cannot be paid", async () => {
    mockQuote = { ...QUOTE_NGN, status: "draft" };
    await expect(
      paymentLink.createQuotationPaymentLink({
        brand: "pixiegirl",
        quotation_id: QUOTE_NGN.quotation_id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  test("an expired quote cannot be paid", async () => {
    mockQuote = {
      ...QUOTE_NGN,
      valid_until: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10),
    };
    await expect(
      paymentLink.createQuotationPaymentLink({
        brand: "pixiegirl",
        quotation_id: QUOTE_NGN.quotation_id,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  test("a quote is payable through the whole of its last valid day", async () => {
    // valid_until is a DATE — expiring at midnight would kill a quote the
    // customer was told is good "until the 30th" on the morning of the 30th.
    mockQuote = {
      ...QUOTE_NGN,
      valid_until: new Date().toISOString().slice(0, 10),
    };
    await expect(
      paymentLink.createQuotationPaymentLink({
        brand: "pixiegirl",
        quotation_id: QUOTE_NGN.quotation_id,
      }),
    ).resolves.toMatchObject({ amount_ngn: "250000.00" });
  });

  test("a zero-total quote has nothing to charge", async () => {
    mockQuote = { ...QUOTE_NGN, total_ngn: "0.00" };
    await expect(
      paymentLink.createQuotationPaymentLink({
        brand: "pixiegirl",
        quotation_id: QUOTE_NGN.quotation_id,
      }),
    ).rejects.toMatchObject({ code: "NOTHING_DUE" });
  });
});

describe("previewQuotationByToken", () => {
  const repo = require("../../../src/modules/sales/sales.repo");

  test("reports payable=false for an expired quote rather than throwing", async () => {
    // The public page needs to RENDER an expired quote (with an explanation),
    // not 500 on it.
    repo.findQuotationByPayToken.mockImplementation(async ({ brand }) =>
      brand === "pixiegirl"
        ? {
            ...QUOTE_NGN,
            valid_until: new Date(Date.now() - DAY).toISOString().slice(0, 10),
          }
        : null,
    );
    const preview = await paymentLink.previewQuotationByToken({
      token: "tok-abc",
    });
    expect(preview.payable).toBe(false);
    expect(preview.total_ngn).toBe("250000.00");
    expect(preview.brand).toBe("pixiegirl");
  });

  test("surfaces the order a converted quote became", async () => {
    repo.findQuotationByPayToken.mockImplementation(async ({ brand }) =>
      brand === "pixiegirl"
        ? {
            ...QUOTE_NGN,
            status: "converted",
            converted_sales_order_id: "ord-9",
          }
        : null,
    );
    const preview = await paymentLink.previewQuotationByToken({
      token: "tok-abc",
    });
    expect(preview.payable).toBe(false);
    expect(preview.converted_sales_order_id).toBe("ord-9");
  });
});
