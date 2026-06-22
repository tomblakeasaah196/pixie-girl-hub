/**
 * Monthly target → bonus automation (HR — meeting §3.3).
 *
 * When a staff member hits a monthly performance target (e.g. "100 styles →
 * 20% bonus"), the dashboard celebrates and a bonus is auto-created. We listen
 * for the distinct `target_achieved` transition event (emitted exactly once
 * when a target flips active → achieved) so the bonus is awarded only once.
 *
 * The bonus is created as a normal pending-approval bonus — it still flows
 * through HR approval and the next payroll run, so nothing is paid silently.
 * The handler is fully defensive: any failure is logged and swallowed so a
 * bonus hiccup never blocks progress updates.
 */

"use strict";

const events = require("./hr.events");
const hrRepo = require("./hr_ops.repo");
const payroll = require("./payroll.service");
const { logger } = require("../../config/logger");

function bonusType(metric) {
  return metric === "sales_count" || metric === "sales_revenue"
    ? "sales_target"
    : "milestone";
}

async function onTargetAchieved({ brand, target_id }) {
  try {
    const target = await hrRepo.findTarget({ brand, id: target_id });
    if (!target) return;
    if (target.reward_type === "none" || Number(target.reward_value) <= 0) return;

    const profile = await hrRepo.profileById({ brand, profileId: target.profile_id });
    if (!profile || !profile.user_id) {
      logger.warn(
        { brand, target_id },
        "target_achieved: no linked user — bonus skipped",
      );
      return;
    }

    const amount =
      target.reward_type === "pct_salary"
        ? Math.round(Number(profile.base_salary || 0) * Number(target.reward_value)) / 100
        : Number(target.reward_value);
    if (!(amount > 0)) return;

    await payroll.awardBonus({
      brand,
      user: { user_id: target.set_by || profile.user_id },
      request_id: null,
      input: {
        user_id: profile.user_id,
        bonus_type: bonusType(target.metric),
        amount_ngn: amount,
        reason: `Target achieved: ${target.metric_label} (${target.period_month}/${target.period_year})`,
      },
    });
    logger.info({ brand, target_id, amount }, "target_achieved: bonus awarded");
  } catch (err) {
    logger.error({ err, brand, target_id }, "target_achieved bonus failed");
  }
}

events.on("target_achieved", onTargetAchieved);

module.exports = { onTargetAchieved };
