"use strict";

/**
 * canUseFeature (Q7 tiered caps + Q8 per-brand + per-user).
 *
 * Every check we care about, exhaustively — because the storefront-vs-
 * internal split is the exact invariant behind "revenue features die
 * last" and getting it wrong would silently re-create the Jul 2026 kind
 * of outage under a different disguise (this time via the budget cap).
 */

jest.mock("../../../src/config/env", () => ({
  config: { ENABLE_AUDIT_LOG: false },
  validateEnv: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/governance.repo", () => ({
  findFlag: jest.fn(),
  hasGrant: jest.fn(),
  userCallsToday: jest.fn(),
  activePeriod: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/brand-voice.repo", () => ({}));
jest.mock("../../../src/modules/ai_governance/model-catalogue.repo", () => ({}));
jest.mock("../../../src/services/encryption.service", () => ({}));

const repo = require("../../../src/modules/ai_governance/governance.repo");
const { canUseFeature } = require("../../../src/modules/ai_governance/governance.service");

function seedFlag(overrides = {}) {
  return {
    flag_id: "fid",
    feature_key: "shop_ai_search",
    is_enabled: true,
    feature_scope: "storefront",
    enabled_for_pxg: true,
    enabled_for_flh: true,
    daily_user_cap: null,
    resting_message: "Praxis is resting for now — try WhatsApp ✨",
    ...overrides,
  };
}
function seedPeriod(overrides = {}) {
  return {
    period_id: "pid",
    soft_cap_ngn: "75000",
    hard_cap_ngn: "80000",
    actual_spend_ngn: "10000",
    hard_cap_breached_at: null,
    storefront_soft_cap_ngn: null,
    storefront_hard_cap_ngn: null,
    storefront_actual_spend_ngn: "0",
    storefront_hard_cap_breached_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.hasGrant.mockResolvedValue(true);
  repo.userCallsToday.mockResolvedValue(0);
  repo.activePeriod.mockResolvedValue(seedPeriod());
});

// ── Global gates ────────────────────────────────────────────────

test("returns FEATURE_DISABLED when the flag row is missing", async () => {
  repo.findFlag.mockResolvedValue(null);
  const r = await canUseFeature({
    user_id: null,
    feature_key: "shop_ai_search",
    is_ceo: true,
  });
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("FEATURE_DISABLED");
});

test("surfaces the CEO-authored resting_message on disable", async () => {
  repo.findFlag.mockResolvedValue(seedFlag({ is_enabled: false }));
  const r = await canUseFeature({
    user_id: null,
    feature_key: "shop_ai_search",
    is_ceo: true,
    business: "faitlynhair",
  });
  expect(r.ok).toBe(false);
  expect(r.resting_message).toMatch(/Praxis is resting/);
});

// ── Per-brand toggle (Q8) ───────────────────────────────────────

test("blocks a brand when its per-brand toggle is off (Q8)", async () => {
  repo.findFlag.mockResolvedValue(seedFlag({ enabled_for_flh: false }));
  const flh = await canUseFeature({
    user_id: null,
    feature_key: "shop_ai_search",
    is_ceo: true,
    business: "faitlynhair",
  });
  expect(flh.ok).toBe(false);
  expect(flh.reason).toBe("FEATURE_DISABLED_FOR_BRAND");
  const pxg = await canUseFeature({
    user_id: null,
    feature_key: "shop_ai_search",
    is_ceo: true,
    business: "pixiegirl",
  });
  expect(pxg.ok).toBe(true);
});

// ── Per-user daily cap (Q8) ─────────────────────────────────────

test("blocks when the staff user has hit their daily cap", async () => {
  repo.findFlag.mockResolvedValue(
    seedFlag({ feature_scope: "internal", daily_user_cap: 20 }),
  );
  repo.userCallsToday.mockResolvedValue(20);
  const r = await canUseFeature({
    user_id: "u1",
    feature_key: "praxis_chat",
    is_ceo: false,
    business: "pixiegirl",
  });
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("USER_DAILY_CAP");
  expect(r.used_today).toBe(20);
});

test("skips the per-user cap for storefront features (they gate on Redis quotas)", async () => {
  repo.findFlag.mockResolvedValue(
    seedFlag({ feature_scope: "storefront", daily_user_cap: 5 }),
  );
  repo.userCallsToday.mockResolvedValue(100);
  const r = await canUseFeature({
    user_id: null,
    feature_key: "shop_ai_search",
    is_ceo: true,
  });
  expect(r.ok).toBe(true);
});

// ── Tiered caps (Q7) ────────────────────────────────────────────

test("internal features are blocked when the INTERNAL hard cap is breached", async () => {
  repo.findFlag.mockResolvedValue(seedFlag({ feature_scope: "internal" }));
  repo.activePeriod.mockResolvedValue(
    seedPeriod({ hard_cap_breached_at: "2026-07-08T12:00:00Z" }),
  );
  const r = await canUseFeature({
    user_id: null,
    feature_key: "praxis_chat",
    is_ceo: true,
  });
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("BUDGET_HARD_CAP");
});

test("STOREFRONT features stay UP when only the internal cap is breached (revenue-features-die-last)", async () => {
  repo.findFlag.mockResolvedValue(seedFlag({ feature_scope: "storefront" }));
  repo.activePeriod.mockResolvedValue(
    seedPeriod({
      hard_cap_breached_at: "2026-07-08T12:00:00Z",
      storefront_hard_cap_ngn: null, // uncapped storefront
    }),
  );
  const r = await canUseFeature({
    user_id: null,
    feature_key: "shop_ai_search",
    is_ceo: true,
    business: "faitlynhair",
  });
  expect(r.ok).toBe(true);
});

test("storefront features honour their OWN cap when set", async () => {
  repo.findFlag.mockResolvedValue(seedFlag({ feature_scope: "storefront" }));
  repo.activePeriod.mockResolvedValue(
    seedPeriod({
      storefront_hard_cap_ngn: "5000",
      storefront_actual_spend_ngn: "5000",
    }),
  );
  const r = await canUseFeature({
    user_id: null,
    feature_key: "shop_ai_search",
    is_ceo: true,
    business: "faitlynhair",
  });
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("STOREFRONT_BUDGET_HARD_CAP");
});

test("internal features stay UP when only the STOREFRONT cap is breached", async () => {
  repo.findFlag.mockResolvedValue(seedFlag({ feature_scope: "internal" }));
  repo.activePeriod.mockResolvedValue(
    seedPeriod({
      storefront_hard_cap_ngn: "5000",
      storefront_actual_spend_ngn: "5000",
      storefront_hard_cap_breached_at: "2026-07-08T12:00:00Z",
    }),
  );
  const r = await canUseFeature({
    user_id: null,
    feature_key: "praxis_chat",
    is_ceo: true,
  });
  expect(r.ok).toBe(true);
});
