/**
 * Retention strategy scanner (Module 6.23). Runs daily: fires the time-based
 * triggers (birthday, anniversary, win-back, inactivity, reorder reminder,
 * subscription renewal reminder, points expiring) for the customers who match
 * today, and expires stale loyalty points.
 *
 * Inactivity-style strategies enrol a customer on the day they *cross* the
 * threshold encoded in the strategy's own conditions, so the scanner reads the
 * threshold from each active strategy rather than hard-coding it.
 */

"use strict";

const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const strategyRepo = require("../../modules/retention/strategy.repo");
const scan = require("../../modules/retention/strategy.scan.repo");
const engine = require("../../modules/retention/strategy.engine");

const LAPSE_TRIGGERS = ["win_back", "inactivity", "reorder_reminder"];
const DEFAULT_DAYS = { win_back: 60, inactivity: 60, reorder_reminder: 45 };

/** Pull the days threshold a lapse strategy keys off (days_since_last_order). */
function thresholdDays(strategy) {
  const leaves = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.all)) node.all.forEach(walk);
    if (Array.isArray(node.any)) node.any.forEach(walk);
    if (node.field === "days_since_last_order") leaves.push(node);
  };
  walk(strategy.trigger_conditions || {});
  const leaf = leaves.find((l) => ["gte", "gt", "eq"].includes(l.op));
  const v = leaf && Number(leaf.value);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_DAYS[strategy.trigger_type] || 60;
}

async function fireAll({ brand, trigger_type, contactIds, source }) {
  for (const contact_id of contactIds) {
    await engine
      .trigger({ brand, trigger_type, contact_id, source_table: source })
      .catch((err) =>
        logger.warn({ err: err.message, brand, trigger_type }, "scan trigger failed"),
      );
  }
}

async function scanBrand(brand) {
  // Group active scheduled strategies by trigger.
  const byTrigger = (type) => strategyRepo.findActiveByTrigger({ brand, trigger_type: type });

  // Birthday / anniversary.
  if ((await byTrigger("birthday")).length) {
    await fireAll({
      brand,
      trigger_type: "birthday",
      contactIds: await scan.birthdaysToday({ brand }),
      source: "contacts",
    });
  }
  if ((await byTrigger("anniversary")).length) {
    await fireAll({
      brand,
      trigger_type: "anniversary",
      contactIds: await scan.signupAnniversariesToday({ brand }),
      source: "contacts",
    });
  }

  // Lapse-style: read each strategy's threshold and fire on the crossing day.
  for (const type of LAPSE_TRIGGERS) {
    const strategies = await byTrigger(type);
    const seenDays = new Set();
    for (const strat of strategies) {
      const days = thresholdDays(strat);
      if (seenDays.has(days)) continue; // one scan per distinct threshold
      seenDays.add(days);
      const contactIds = await scan.lapsedExactlyNDaysAgo({ brand, days });
      await fireAll({ brand, trigger_type: type, contactIds, source: "sales_orders" });
    }
  }

  // Subscription renewal reminder (3 days before by default).
  if ((await byTrigger("subscription_renewal_reminder")).length) {
    await fireAll({
      brand,
      trigger_type: "subscription_renewal_reminder",
      contactIds: await scan.subscriptionsRenewingInDays({ brand, days: 3 }),
      source: "subscriptions",
    });
  }

  // Abandoned carts (no activity for 1h+). Flagged once, then enrolled.
  if ((await byTrigger("cart_abandoned")).length) {
    await fireAll({
      brand,
      trigger_type: "cart_abandoned",
      contactIds: await scan.abandonedCarts({ brand, hours: 1 }),
      source: "carts",
    });
  }

  // Points expiring (7 days before by default).
  if ((await byTrigger("points_expiring")).length) {
    await fireAll({
      brand,
      trigger_type: "points_expiring",
      contactIds: await scan.pointsExpiringInDays({ brand, days: 7 }),
      source: "loyalty_ledger",
    });
  }

  // Expire stale points (independent of strategies).
  const expired = await scan.expireDuePoints({ brand });
  return { expired };
}

async function runRetentionStrategyScan() {
  let expired = 0;
  for (const brand of BRANDS) {
    try {
      const out = await scanBrand(brand);
      expired += out.expired;
    } catch (err) {
      logger.error({ err: err.message, brand }, "retention strategy scan failed");
    }
  }
  logger.info({ expired }, "retention strategy scan complete");
  return { expired };
}

module.exports = { runRetentionStrategyScan, thresholdDays };
