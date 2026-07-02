"use strict";

/**
 * Config-driven loyalty earning (§6.23). Verifies earnForOrder resolves the
 * loyalty_earn_rules (per-currency + tier multiplier + expiry) instead of the
 * old hardcoded rate. DB deps are mocked; money math (decimal.js) is real.
 */

jest.mock("../../../src/modules/retention/retention.repo");
jest.mock("../../../src/modules/retention/earn.repo");
jest.mock("../../../src/modules/retention/referral-config.repo", () => ({}));
jest.mock("../../../src/modules/retention/retention.events", () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock("../../../src/modules/business_setup/business-config.repo", () => ({ findByKey: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
  query: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
// Earning now provisions the loyalty liability on the GL (policy Q13).
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(async () => ({ entry_id: "gl-1" })),
}));

const repo = require("../../../src/modules/retention/retention.repo");
const earnRepo = require("../../../src/modules/retention/earn.repo");
const service = require("../../../src/modules/retention/retention.service");

describe("retention.service.earnForOrder (config-driven)", () => {
  beforeEach(() => {
    repo.getLoyaltyState.mockResolvedValue({
      earning_multiplier: 2,
      lifetime_earned: 200,
      current_tier_id: null,
    });
    repo.ledgerEntryForReference.mockResolvedValue(null);
    repo.tierForLifetime.mockResolvedValue(null);
    repo.setLoyaltyTier.mockResolvedValue();
    repo.insertLoyaltyLedger.mockImplementation(({ entry }) => ({ ledger_id: "L", ...entry }));
  });

  test("per-currency rule × tier multiplier, with expiry", async () => {
    earnRepo.listActiveEarnRules.mockResolvedValue([
      { points_mode: "per_currency", currency_per_point: 100, apply_tier_multiplier: true, points_expire_days: 365 },
    ]);
    const entry = await service.earnForOrder({
      client: {},
      brand: "pixiegirl",
      contact_id: "c1",
      order_id: "o1",
      total_ngn: 10000,
    });
    // floor(10000/100)=100, ×2 tier multiplier = 200
    expect(entry.points).toBe(200);
    expect(entry.expires_at).toBeTruthy();
    expect(repo.insertLoyaltyLedger).toHaveBeenCalledTimes(1);
  });

  test("idempotent: existing earn returns the existing entry", async () => {
    repo.ledgerEntryForReference.mockResolvedValue({ ledger_id: "existing" });
    const entry = await service.earnForOrder({
      client: {},
      brand: "pixiegirl",
      contact_id: "c1",
      order_id: "o1",
      total_ngn: 10000,
    });
    expect(entry.ledger_id).toBe("existing");
    expect(repo.insertLoyaltyLedger).not.toHaveBeenCalled();
  });

  test("falls back to legacy rate when no earn rule is configured", async () => {
    earnRepo.listActiveEarnRules.mockResolvedValue([]);
    require("../../../src/modules/business_setup/business-config.repo").findByKey.mockResolvedValue({
      loyalty_settings: { points_per_naira: 100 },
    });
    const entry = await service.earnForOrder({
      client: {},
      brand: "pixiegirl",
      contact_id: "c1",
      order_id: "o2",
      total_ngn: 10000,
    });
    // floor(10000/100)=100 ×2 = 200
    expect(entry.points).toBe(200);
  });
});
