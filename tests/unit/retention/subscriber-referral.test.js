"use strict";

/**
 * order.paid → referral auto-redeem wiring (§6.23). The retention subscriber
 * should redeem a referral only when the paid order carried a referral code.
 * Heavy deps (service, engine, db) are mocked; we assert the wiring, not the
 * redemption math (covered by referral-ladder.test.js).
 */

jest.mock("../../../src/shared/outbox/outbox", () => ({ register: jest.fn() }));
jest.mock("../../../src/modules/retention/strategy.engine", () => ({ trigger: jest.fn().mockResolvedValue({}) }));
jest.mock("../../../src/modules/retention/retention.events", () => ({ on: jest.fn(), emit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({ query: jest.fn().mockResolvedValue({ rows: [{ c: 1 }] }) }));
jest.mock("../../../src/config/brands", () => ({ VALID: new Set(["pixiegirl"]), BRANDS: ["pixiegirl"] }));
jest.mock("../../../src/modules/retention/retention.service", () => ({
  earnForOrder: jest.fn().mockResolvedValue(null),
  awardStars: jest.fn().mockResolvedValue(null),
  redeemReferral: jest.fn().mockResolvedValue({}),
}));

const service = require("../../../src/modules/retention/retention.service");
const { awardLoyaltyAndStreak } = require("../../../src/modules/retention/retention.subscribers");

const base = { brand: "pixiegirl", order_id: "o1", contact_id: "c1", total_ngn: 50000 };

describe("retention subscriber — referral auto-redeem", () => {
  test("redeems when a referral code is present", async () => {
    await awardLoyaltyAndStreak({ ...base, referral_code: "FAITH123" });
    expect(service.redeemReferral).toHaveBeenCalledWith(
      expect.objectContaining({ code: "FAITH123", referred_contact_id: "c1", order_id: "o1" }),
    );
  });

  test("does not redeem when no referral code", async () => {
    await awardLoyaltyAndStreak({ ...base });
    expect(service.redeemReferral).not.toHaveBeenCalled();
  });

  test("always awards purchase points", async () => {
    await awardLoyaltyAndStreak({ ...base });
    expect(service.earnForOrder).toHaveBeenCalled();
  });
});
