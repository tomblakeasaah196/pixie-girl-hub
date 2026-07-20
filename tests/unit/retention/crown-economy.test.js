"use strict";

/**
 * Crowns 👑 economy — awardByRule (§6.23). Verifies the earn math (flat +
 * per-currency), the anti-abuse caps, per-reference idempotency, and the
 * one-time voucher minted when an earn crosses a tier threshold. crown.repo is
 * mocked; we assert the engine's decisions, not the SQL.
 */

jest.mock("../../../src/modules/retention/crown.repo");
jest.mock("../../../src/modules/retention/retention.events", () => ({
  on: jest.fn(),
  emit: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
  ex: () => jest.fn(),
  query: jest.fn(),
}));

const repo = require("../../../src/modules/retention/crown.repo");
const service = require("../../../src/modules/retention/crown.service");

function resetRepo() {
  repo.ledgerForReference.mockResolvedValue(null);
  repo.countAwards.mockResolvedValue(0);
  repo.countAwardsInWindow.mockResolvedValue(0);
  repo.getState.mockResolvedValue(null);
  repo.getTierById.mockResolvedValue(null);
  repo.listTiers.mockResolvedValue([]);
  repo.grantExistsForTier.mockResolvedValue(null);
  repo.insertGrant.mockResolvedValue({});
  repo.insertLedger.mockImplementation(({ entry }) => ({
    ledger_id: "l1",
    ...entry,
  }));
}

const ctx = (rule, extra = {}) => ({
  client: {},
  brand: "pixiegirl",
  contact_id: "c1",
  rule,
  reference_type: "sales_order",
  reference_id: "o1",
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetRepo();
});

describe("crown economy — awardByRule", () => {
  test("flat rule awards its crown_value", async () => {
    const rule = {
      rule_id: "r1",
      is_active: true,
      action_type: "complete_purchase",
      crowns_mode: "flat",
      crown_value: 500,
    };
    const entry = await service.awardByRule(ctx(rule));
    expect(entry.crowns).toBe(500);
    expect(repo.insertLedger).toHaveBeenCalledWith(
      expect.objectContaining({ entry: expect.objectContaining({ crowns: 500 }) }),
    );
  });

  test("per_currency rule floors amount ÷ unit", async () => {
    const rule = {
      rule_id: "r2",
      is_active: true,
      action_type: "money_spent",
      crowns_mode: "per_currency",
      unit_currency_per_crown: 1000,
    };
    const entry = await service.awardByRule(ctx(rule, { amount_ngn: 50500 }));
    expect(entry.crowns).toBe(50);
  });

  test("lifetime cap blocks a repeat earn", async () => {
    repo.countAwards.mockResolvedValue(1);
    const rule = {
      rule_id: "r3",
      is_active: true,
      action_type: "add_birthday",
      crowns_mode: "flat",
      crown_value: 20,
      max_awards_per_customer_lifetime: 1,
    };
    const entry = await service.awardByRule(ctx(rule));
    expect(entry).toBeNull();
    expect(repo.insertLedger).not.toHaveBeenCalled();
  });

  test("idempotent per reference — returns the existing entry", async () => {
    repo.ledgerForReference.mockResolvedValue({ ledger_id: "prev", crowns: 500 });
    const rule = {
      rule_id: "r1",
      is_active: true,
      action_type: "complete_purchase",
      crowns_mode: "flat",
      crown_value: 500,
    };
    const entry = await service.awardByRule(ctx(rule));
    expect(entry.ledger_id).toBe("prev");
    expect(repo.insertLedger).not.toHaveBeenCalled();
  });

  test("crossing a tier threshold mints a next-purchase voucher", async () => {
    repo.getState.mockResolvedValue({ lifetime_earned: 900, current_tier_id: null });
    repo.listTiers.mockResolvedValue([
      {
        tier_id: "t1",
        min_crowns: 1000,
        next_purchase_discount_pct: 5,
        grants_free_shipping_next: false,
        tier_name: "The Tiara",
      },
    ]);
    const rule = {
      rule_id: "r1",
      is_active: true,
      action_type: "complete_purchase",
      crowns_mode: "flat",
      crown_value: 200, // 900 → 1100 crosses 1000
    };
    await service.awardByRule(ctx(rule));
    expect(repo.insertGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: expect.objectContaining({
          grant_type: "next_purchase_discount",
          discount_pct: 5,
          tier_id: "t1",
        }),
      }),
    );
  });

  test("an earn below the next threshold mints no voucher", async () => {
    repo.getState.mockResolvedValue({ lifetime_earned: 100, current_tier_id: null });
    repo.listTiers.mockResolvedValue([
      { tier_id: "t1", min_crowns: 1000, next_purchase_discount_pct: 5 },
    ]);
    const rule = {
      rule_id: "r1",
      is_active: true,
      action_type: "complete_purchase",
      crowns_mode: "flat",
      crown_value: 500, // 100 → 600, still < 1000
    };
    await service.awardByRule(ctx(rule));
    expect(repo.insertGrant).not.toHaveBeenCalled();
  });
});
