"use strict";

/**
 * Retention repo × DB schema shape tests.
 *
 * The audit's headline P0 findings (strategy.facts / workflow.service selecting
 * a non-existent `business` column on shared.contacts, storefront.service
 * quoteCart selecting `code` instead of `coupon_code`) all shared a root
 * cause: unit tests are pure-function only, so a repo query that references
 * a column the migrations never created shipped, crashed at runtime, and was
 * caught only by production log noise. This suite closes that gap.
 *
 * The rule it enforces: every retention repo function exported from a
 * .repo.js file MUST resolve against the live schema. We call each one with
 * throwaway inputs (real UUIDs, valid brand keys) inside a transaction that
 * ROLLS BACK at the end — so nothing pollutes the DB — and assert only that
 * the call did not throw a Postgres schema error (42703 undefined_column,
 * 42P01 undefined_table, 42883 undefined_function). Business-logic failures
 * (constraint violations from bogus data, "not found" returns, FK RESTRICT
 * on invented IDs) are expected and ignored.
 *
 * OPT-IN: needs a migrated DB. Enable with RUN_DB_TESTS=1.
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const db = require("../../src/config/database");

const retentionRepo = require("../../src/modules/retention/retention.repo");
const couponRepo = require("../../src/modules/retention/coupon.repo");
const bundleRepo = require("../../src/modules/retention/bundle.repo");
const earnRepo = require("../../src/modules/retention/earn.repo");
const rewardsRepo = require("../../src/modules/retention/rewards.repo");
const strategyRepo = require("../../src/modules/retention/strategy.repo");
const strategyScanRepo = require("../../src/modules/retention/strategy.scan.repo");
const subscriptionRepo = require("../../src/modules/retention/subscription.repo");
const referralConfigRepo = require("../../src/modules/retention/referral-config.repo");
const maintenanceRepo = require("../../src/modules/retention/maintenance.repo");

const SCHEMA_ERRORS = new Set(["42703", "42P01", "42883", "42704", "42P02"]);
const BRAND = "pixiegirl";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const suite = RUN ? describe : describe.skip;

/**
 * Run `fn` inside a transaction that always ROLLS BACK. Any Postgres schema
 * error propagates out as-is (we assert on it in the test); business-logic
 * errors are swallowed because they're not what this suite guards.
 */
async function shape(fn) {
  const client = await db.getPool().connect();
  try {
    await client.query("BEGIN");
    try {
      await fn(client);
    } catch (err) {
      if (err && SCHEMA_ERRORS.has(err.code)) throw err;
      // Any other error (23xxx constraint, 22xxx data, application throws)
      // means the QUERY resolved against the schema — good enough for the
      // shape check.
    }
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    client.release();
  }
}

/**
 * Every retention .repo.js function that hits the DB. When you add a new
 * repo method that runs SQL, add it here (it's cheap — the test just
 * invokes it once). The arguments are deliberately minimal / bogus; we
 * only care that the SQL parses against the real schema.
 */
const CASES = [
  // retention.repo — the P0-1 site: shared.contacts has no `business` column.
  ["retention.getLoyaltyState", (c) => retentionRepo.getLoyaltyState({ client: c, brand: BRAND, contact_id: NIL_UUID })],
  ["retention.getLoyaltyStateForUpdate (P1-5)", (c) => retentionRepo.getLoyaltyStateForUpdate({ client: c, brand: BRAND, contact_id: NIL_UUID })],
  ["retention.ledgerEntryForReference (P0-7 with contact scope)", (c) => retentionRepo.ledgerEntryForReference({ client: c, brand: BRAND, contact_id: NIL_UUID, reference_type: "sales_order", reference_id: NIL_UUID, transaction_type: "redeemed" })],
  ["retention.listLoyaltyLedger", (c) => retentionRepo.listLoyaltyLedger({ client: c, brand: BRAND, contact_id: NIL_UUID })],
  ["retention.listLoyaltyTiers", (c) => retentionRepo.listLoyaltyTiers({ client: c, brand: BRAND })],
  ["retention.tierForLifetime", (c) => retentionRepo.tierForLifetime({ client: c, brand: BRAND, lifetime: 0 })],
  ["retention.findReferralByContact", (c) => retentionRepo.findReferralByContact({ client: c, brand: BRAND, contact_id: NIL_UUID })],
  ["retention.findReferralByCode (P1-4 brand-scoped)", (c) => retentionRepo.findReferralByCode({ client: c, code: "NOPE", brand: BRAND })],
  ["retention.findRedemption", (c) => retentionRepo.findRedemption({ client: c, referral_id: NIL_UUID, referred_contact_id: NIL_UUID })],
  ["retention.storeCreditBalance (P1-7)", (c) => retentionRepo.storeCreditBalance({ client: c, brand: BRAND, contact_id: NIL_UUID })],
  ["retention.listStreakTiers", (c) => retentionRepo.listStreakTiers({ client: c, brand: BRAND })],
  ["retention.listStreakRules", (c) => retentionRepo.listStreakRules({ client: c, brand: BRAND, action_type: "money_spent" })],
  ["retention.streakLedgerForReference (P0-7 with contact scope)", (c) => retentionRepo.streakLedgerForReference({ client: c, brand: BRAND, contact_id: NIL_UUID, reference_type: "sales_order", reference_id: NIL_UUID, action_type: "money_spent" })],
  ["retention.getStreakState", (c) => retentionRepo.getStreakState({ client: c, brand: BRAND, contact_id: NIL_UUID })],
  ["retention.listStreakLedger", (c) => retentionRepo.listStreakLedger({ client: c, brand: BRAND, contact_id: NIL_UUID })],
  ["retention.countStreakAwards", (c) => retentionRepo.countStreakAwards({ client: c, brand: BRAND, contact_id: NIL_UUID, rule_id: NIL_UUID })],
  ["retention.getActiveQuiz", (c) => retentionRepo.getActiveQuiz({ client: c, brand: BRAND })],
  ["retention.recommendVariants", (c) => retentionRepo.recommendVariants({ client: c, brand: BRAND, hints: {} })],

  // coupon.repo
  ["coupon.list", () => couponRepo.list({ brand: BRAND })],
  ["coupon.getByCode", (c) => couponRepo.getByCode({ client: c, brand: BRAND, code: "NOPE" })],
  ["coupon.countCustomerRedemptions", (c) => couponRepo.countCustomerRedemptions({ client: c, coupon_id: NIL_UUID, contact_id: NIL_UUID })],
  ["coupon.redemptionExists", (c) => couponRepo.redemptionExists({ client: c, coupon_id: NIL_UUID, reference_type: "sales_order", reference_id: NIL_UUID })],
  ["coupon.listRedemptionsForOrder (P1-3)", (c) => couponRepo.listRedemptionsForOrder({ client: c, reference_type: "sales_order", reference_id: NIL_UUID })],

  // bundle.repo
  ["bundle.list (via listBundles)", () => bundleRepo.list({ brand: BRAND })],

  // earn.repo
  ["earn.listActiveEarnRules", (c) => earnRepo.listActiveEarnRules({ client: c, brand: BRAND, action_type: "earned_purchase" })],
  ["earn.countEarnsByType", (c) => earnRepo.countEarnsByType({ client: c, brand: BRAND, contact_id: NIL_UUID, transaction_type: "earned_purchase" })],

  // rewards.repo
  ["rewards.listActive", () => rewardsRepo.listActive({ brand: BRAND })],
  ["rewards.listAll", () => rewardsRepo.listAll({ brand: BRAND })],

  // strategy.repo
  ["strategy.listStrategies", () => strategyRepo.listStrategies({ brand: BRAND })],

  // strategy.scan.repo — the sweep functions the audit called out.
  ["strategyScan.abandonedCarts", () => strategyScanRepo.abandonedCarts({ brand: BRAND, hours: 1, limit: 5 })],
  ["strategyScan.birthdaysToday", () => strategyScanRepo.birthdaysToday({ brand: BRAND, limit: 5 })],
  ["strategyScan.lapsedExactlyNDaysAgo", () => strategyScanRepo.lapsedExactlyNDaysAgo({ brand: BRAND, days: 30, limit: 5 })],
  ["strategyScan.pointsExpiringInDays", () => strategyScanRepo.pointsExpiringInDays({ brand: BRAND, days: 7, limit: 5 })],

  // subscription.repo (P0-6 rewritten claim query)
  ["subscription.listPlans", () => subscriptionRepo.listPlans({ brand: BRAND })],

  // referral-config.repo
  ["referralConfig.getSettings", (c) => referralConfigRepo.getSettings({ client: c, brand: BRAND })],
  ["referralConfig.tierForCount", (c) => referralConfigRepo.tierForCount({ client: c, brand: BRAND, count: 3 })],

  // maintenance.repo
  ["maintenance.listPlans", () => maintenanceRepo.listPlans({ brand: BRAND })],
];

suite("Retention repos — schema shape (P0-1 regression tier)", () => {
  beforeAll(async () => {
    await db.initDatabase();
  });

  afterAll(async () => {
    await db.closeDatabase();
  });

  test.each(CASES)("%s runs against the real schema", async (_label, fn) => {
    let capturedErr = null;
    await shape(async (client) => {
      try {
        await fn(client);
      } catch (err) {
        if (err && SCHEMA_ERRORS.has(err.code)) capturedErr = err;
        else throw err; // let shape() swallow non-schema errors
      }
    });
    if (capturedErr) {
      throw new Error(
        `Postgres schema error ${capturedErr.code}: ${capturedErr.message}`,
      );
    }
  });
});
