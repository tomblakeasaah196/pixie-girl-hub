"use strict";

/**
 * Referral accrual on order.paid (§6.26 Q17). Repos/notify are mocked; we
 * assert the commission math (stylist override → config default), the
 * quality-hold payable_at, and idempotency on replay.
 */

jest.mock("../../../src/modules/stylist_programme/stylist.repo", () => ({
  findPartner: jest.fn(),
}));
jest.mock("../../../src/modules/stylist_programme/programme.repo", () => ({
  findOrderReferralCode: jest.fn(),
  resolveReferralCode: jest.fn(),
  getConfig: jest.fn(),
  createAttribution: jest.fn(),
  listAttributions: jest.fn(),
  listReferralLinks: jest.fn(),
  createReferralLink: jest.fn(),
  bumpReferralClicks: jest.fn(),
}));
jest.mock("../../../src/modules/stylist_programme/stylist.notify", () => ({
  notifyStylist: jest.fn().mockResolvedValue(undefined),
  emailAddress: jest.fn().mockResolvedValue(undefined),
  portalBaseUrl: jest.fn().mockResolvedValue("https://style.example.com"),
  BRAND: "pixiegirl",
}));
jest.mock("../../../src/modules/stylist_programme/stylist.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));

const programmeRepo = require("../../../src/modules/stylist_programme/programme.repo");
const referral = require("../../../src/modules/stylist_programme/referral.service");

const order = {
  order_id: "o1",
  order_number: "PXG-SO-0001",
  total_ngn: "120000.00",
  stylist_referral_code: "pxs-abc",
};

beforeEach(() => {
  jest.clearAllMocks();
  programmeRepo.findOrderReferralCode.mockResolvedValue(order);
  programmeRepo.getConfig.mockResolvedValue({
    referral_commission_pct: 10,
    quality_hold_days: 7,
  });
  programmeRepo.createAttribution.mockImplementation(async ({ a }) => ({
    attribution_id: "attr1",
    ...a,
  }));
});

describe("referral accrual (order.paid)", () => {
  test("accrues the config-default commission with a 7-day hold", async () => {
    programmeRepo.resolveReferralCode.mockResolvedValue({
      stylist_id: "s1",
      referral_commission_pct: null,
      status: "certified",
    });
    const out = await referral.accrueForPaidOrder({
      brand: "pixiegirl",
      order_id: "o1",
    });
    expect(out.commission_amount_ngn).toBe("12000.00"); // 10% of 120k
    const call = programmeRepo.createAttribution.mock.calls[0][0].a;
    expect(call.stylist_id).toBe("s1");
    const holdMs = new Date(call.payable_at) - Date.now();
    expect(holdMs).toBeGreaterThan(6.9 * 86_400_000);
    expect(holdMs).toBeLessThan(7.1 * 86_400_000);
  });

  test("a per-stylist commission override beats the config default", async () => {
    programmeRepo.resolveReferralCode.mockResolvedValue({
      stylist_id: "s1",
      referral_commission_pct: "15.00",
      status: "certified",
    });
    const out = await referral.accrueForPaidOrder({
      brand: "pixiegirl",
      order_id: "o1",
    });
    expect(out.commission_amount_ngn).toBe("18000.00"); // 15% of 120k
  });

  test("no code on the order → no accrual", async () => {
    programmeRepo.findOrderReferralCode.mockResolvedValue({
      ...order,
      stylist_referral_code: null,
    });
    const out = await referral.accrueForPaidOrder({
      brand: "pixiegirl",
      order_id: "o1",
    });
    expect(out).toBeNull();
    expect(programmeRepo.createAttribution).not.toHaveBeenCalled();
  });

  test("replay is idempotent (ON CONFLICT returns null)", async () => {
    programmeRepo.resolveReferralCode.mockResolvedValue({
      stylist_id: "s1",
      referral_commission_pct: null,
      status: "certified",
    });
    programmeRepo.createAttribution.mockResolvedValue(null);
    const out = await referral.accrueForPaidOrder({
      brand: "pixiegirl",
      order_id: "o1",
    });
    expect(out).toBeNull();
  });

  test("unresolvable code accrues nothing", async () => {
    programmeRepo.resolveReferralCode.mockResolvedValue(null);
    const out = await referral.accrueForPaidOrder({
      brand: "pixiegirl",
      order_id: "o1",
    });
    expect(out).toBeNull();
  });
});
