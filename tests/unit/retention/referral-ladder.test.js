"use strict";

/**
 * Config-driven referral redemption (§6.23). Verifies the tiered ladder picks
 * the right reward, the friend discount is computed from settings, and a
 * duplicate redemption is a no-op. DB deps mocked.
 */

jest.mock("../../../src/modules/retention/retention.repo");
jest.mock("../../../src/modules/retention/earn.repo", () => ({}));
jest.mock("../../../src/modules/retention/referral-config.repo");
jest.mock("../../../src/modules/retention/retention.events", () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock("../../../src/modules/business_setup/business-config.repo", () => ({ findByKey: jest.fn() }));
jest.mock("../../../src/config/database", () => ({ transaction: (fn) => fn({}), query: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const repo = require("../../../src/modules/retention/retention.repo");
const referralConfig = require("../../../src/modules/retention/referral-config.repo");
const service = require("../../../src/modules/retention/retention.service");

describe("retention.service.redeemReferral (config-driven ladder)", () => {
  beforeEach(() => {
    repo.findReferralByCode.mockResolvedValue({
      referral_id: "ref1",
      contact_id: "referrer",
      successful_count: 4,
      reward_rules: {},
    });
    repo.findRedemption.mockResolvedValue(null);
    repo.bumpReferralCounters.mockResolvedValue();
    repo.insertLoyaltyLedger.mockResolvedValue({ ledger_id: "L" });
    repo.getLoyaltyState.mockResolvedValue({ lifetime_earned: 0, current_tier_id: null });
    repo.tierForLifetime.mockResolvedValue(null);
    repo.insertRedemption.mockImplementation(({ redemption }) => ({ redemption_id: "rd1", ...redemption }));
    referralConfig.getSettings.mockResolvedValue({
      is_active: true,
      anti_fraud: {},
      min_qualifying_order_ngn: 0,
      default_referrer_points: 500,
      default_referrer_credit_ngn: 0,
      friend_discount_type: "percentage",
      friend_discount_value: 0.1,
    });
  });

  test("5th successful referral uses the ladder reward + friend discount", async () => {
    referralConfig.tierForCount.mockResolvedValue({ referrer_points: 1500, referrer_credit_ngn: 0 });
    await service.redeemReferral({
      brand: "pixiegirl",
      code: "FAITH123",
      referred_contact_id: "friend",
      order_id: "o1",
      order_value: 20000,
    });
    expect(referralConfig.tierForCount).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5 }),
    );
    const arg = repo.insertRedemption.mock.calls[0][0].redemption;
    expect(arg.referrer_reward_points).toBe(1500);
    expect(arg.referred_discount_value).toBe(2000); // 10% of 20000
  });

  test("blocks self-referral", async () => {
    repo.findReferralByCode.mockResolvedValue({
      referral_id: "ref1",
      contact_id: "friend",
      successful_count: 0,
      reward_rules: {},
    });
    await expect(
      service.redeemReferral({
        brand: "pixiegirl",
        code: "FAITH123",
        referred_contact_id: "friend",
        order_id: "o1",
        order_value: 20000,
      }),
    ).rejects.toThrow(/own code/i);
  });

  test("duplicate redemption is a no-op", async () => {
    repo.findRedemption.mockResolvedValue({ redemption_id: "existing" });
    const out = await service.redeemReferral({
      brand: "pixiegirl",
      code: "FAITH123",
      referred_contact_id: "friend",
      order_id: "o1",
      order_value: 20000,
    });
    expect(out.redemption_id).toBe("existing");
    expect(repo.insertRedemption).not.toHaveBeenCalled();
  });
});
