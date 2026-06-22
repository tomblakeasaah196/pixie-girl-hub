"use strict";

jest.mock("../../../src/services/nomba.service", () => ({
  disburseSalary: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({ error: jest.fn(), info: jest.fn() }));

const nomba = require("../../../src/services/nomba.service");
const d = require("../../../src/services/disbursement.service");

const slip = (over = {}) => ({
  payslip_id: "p1",
  payslip_number: "PXG-SLP-0001",
  net_pay_ngn: 100000,
  bank_account_snapshot: "0123456789",
  ...over,
});

describe("selectProvider", () => {
  test("defaults to nomba", () => {
    expect(d.selectProvider({})).toBe("nomba");
    expect(d.selectProvider({ payout_provider: "x" })).toBe("nomba");
  });
  test("honours manual / flutterwave", () => {
    expect(d.selectProvider({ payout_provider: "manual" })).toBe("manual");
    expect(d.selectProvider({ payout_provider: "flutterwave" })).toBe("flutterwave");
  });
});

describe("disburseSlip", () => {
  beforeEach(() => nomba.disburseSalary.mockReset());

  test("no bank account → failed", async () => {
    const r = await d.disburseSlip({ provider: "nomba", slip: slip({ bank_account_snapshot: null }) });
    expect(r.status).toBe("failed");
    expect(r.reason).toBe("no_bank_account");
  });

  test("zero net pay → paid (nothing to send)", async () => {
    const r = await d.disburseSlip({ provider: "nomba", slip: slip({ net_pay_ngn: 0 }) });
    expect(r.status).toBe("paid");
  });

  test("manual provider → queued for bank schedule", async () => {
    const r = await d.disburseSlip({ provider: "manual", slip: slip() });
    expect(r.status).toBe("queued");
    expect(nomba.disburseSalary).not.toHaveBeenCalled();
  });

  test("nomba success → paid with reference", async () => {
    nomba.disburseSalary.mockResolvedValue({ ok: true, reference: "TX123" });
    const r = await d.disburseSlip({ provider: "nomba", slip: slip() });
    expect(r.status).toBe("paid");
    expect(r.reference).toBe("TX123");
  });

  test("nomba not configured → queued (manual fallback)", async () => {
    nomba.disburseSalary.mockResolvedValue({ ok: false, reason: "not_configured" });
    const r = await d.disburseSlip({ provider: "nomba", slip: slip() });
    expect(r.status).toBe("queued");
  });

  test("nomba error → failed (never throws)", async () => {
    nomba.disburseSalary.mockRejectedValue(new Error("network"));
    const r = await d.disburseSlip({ provider: "nomba", slip: slip() });
    expect(r.status).toBe("failed");
    expect(r.reason).toBe("provider_error");
  });
});
