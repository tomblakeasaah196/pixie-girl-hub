"use strict";

const { paymentCreate } = require("../../../src/modules/sales/sales.validator");

const gateway = {
  method: "paystack_card",
  amount_ngn: 5000,
  provider: "paystack",
  provider_reference: "ref-123",
  payment_path: "gateway",
};

describe("paymentCreate validator (Flexi Pay D13 — staff-recorded path)", () => {
  it("accepts a gateway payment with a reference", () => {
    expect(() => paymentCreate.parse(gateway)).not.toThrow();
  });

  it("rejects a gateway payment missing its provider_reference", () => {
    const { provider_reference, ...noRef } = gateway;
    expect(() => paymentCreate.parse(noRef)).toThrow();
  });

  it("accepts a staff-recorded bank transfer with the mandatory fields", () => {
    const v = paymentCreate.parse({
      method: "bank_transfer",
      amount_ngn: 30000,
      provider: "manual",
      payment_path: "staff_recorded",
      manual_bank_transaction_id: "GTB-TXN-9981",
      manual_bank_name: "GTBank",
    });
    expect(v.manual_bank_transaction_id).toBe("GTB-TXN-9981");
  });

  it("rejects staff-recorded without a bank transaction id", () => {
    expect(() =>
      paymentCreate.parse({
        method: "bank_transfer",
        amount_ngn: 30000,
        provider: "manual",
        payment_path: "staff_recorded",
        manual_bank_name: "GTBank",
      }),
    ).toThrow();
  });

  it("rejects staff-recorded without a bank name", () => {
    expect(() =>
      paymentCreate.parse({
        method: "bank_transfer",
        amount_ngn: 30000,
        provider: "manual",
        payment_path: "staff_recorded",
        manual_bank_transaction_id: "GTB-TXN-9981",
      }),
    ).toThrow();
  });

  it("rejects staff-recorded with a non-bank_transfer method", () => {
    expect(() =>
      paymentCreate.parse({
        method: "paystack_card",
        amount_ngn: 30000,
        provider: "manual",
        payment_path: "staff_recorded",
        manual_bank_transaction_id: "GTB-TXN-9981",
        manual_bank_name: "GTBank",
      }),
    ).toThrow();
  });
});
