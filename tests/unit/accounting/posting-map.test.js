"use strict";

const {
  ACCOUNTS,
  REVENUE_BY_CHANNEL,
  revenueAccountForChannel,
  gatewayFeeAccount,
  settlementAccountForProvider,
} = require("../../../src/modules/accounting/posting-map");

describe("posting map — GL account SSOT", () => {
  test("every account code is a unique 4-digit string", () => {
    const codes = Object.values(ACCOUNTS);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^\d{4}$/);
  });

  test("codes sit in the correct chart range for their class", () => {
    expect(ACCOUNTS.COD_IN_TRANSIT[0]).toBe("1"); // asset
    expect(ACCOUNTS.GRNI[0]).toBe("2"); // liability
    expect(ACCOUNTS.COMMISSIONS_PAYABLE[0]).toBe("2");
    expect(ACCOUNTS.SALES_RETURNS[0]).toBe("4"); // contra revenue
    expect(ACCOUNTS.DEPRECIATION_EXPENSE[0]).toBe("5"); // expense
  });

  test("every sales channel resolves to a revenue account", () => {
    for (const channel of Object.keys(REVENUE_BY_CHANNEL)) {
      expect(revenueAccountForChannel(channel)).toMatch(/^4\d{3}$/);
    }
    expect(revenueAccountForChannel("unknown")).toBe(
      ACCOUNTS.SALES_STOREFRONT,
    );
  });

  test("settlement: Nomba keeps a USD wallet; everything else by provider", () => {
    expect(settlementAccountForProvider("nomba")).toBe("1140");
    expect(settlementAccountForProvider("nomba", "NGN")).toBe("1140");
    expect(settlementAccountForProvider("nomba", "usd")).toBe("1141");
    // No separate wallet → the provider's own float, whatever the currency.
    expect(settlementAccountForProvider("paystack", "USD")).toBe("1120");
    expect(settlementAccountForProvider("manual", "USD")).toBe("1100");
  });

  test("gateway fees: per-provider, Stripe split by currency", () => {
    expect(gatewayFeeAccount("paystack")).toBe("5511");
    expect(gatewayFeeAccount("stripe", "GBP")).toBe("5515");
    expect(gatewayFeeAccount("stripe", null)).toBe("5514");
    expect(gatewayFeeAccount("stripe", "XXX")).toBe("5514");
    expect(gatewayFeeAccount("bank_transfer")).toBeNull();
  });
});
