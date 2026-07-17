/**
 * HR clock-out reminder sweep (HR — attendance automation).
 *
 * Every minute, for each brand, nudges anyone still clocked in as their
 * closing time approaches so nobody forgets to clock out and silently banks
 * supplementary hours. Three nudges per employee per day — 5 minutes before,
 * at, and 5 minutes after their expected close — delivered in-app + web push.
 *
 * The per-nudge dedupe (shared.clockout_reminders UNIQUE claim) lives in the
 * service, so this sweep is safe to run under the cron lock alongside a second
 * worker. Gated per brand by hr_settings.clockout_reminder_enabled.
 *
 * Fans out across BRANDS; each brand is isolated so one failure doesn't stop
 * the rest. System-initiated (no `user`).
 */

"use strict";

const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const hrOps = require("../../shared/hr_payroll/hr_ops.service");

async function runClockoutReminderSweep() {
  for (const brand of BRANDS) {
    try {
      const res = await hrOps.sendClockoutReminders({ brand });
      if (res.sent > 0) {
        logger.info(
          { brand, sent: res.sent, candidates: res.candidates },
          "hr-clockout-reminder-sweep sent nudges",
        );
      }
    } catch (err) {
      logger.error({ err, brand }, "hr-clockout-reminder-sweep failed for brand");
    }
  }
}

module.exports = { runClockoutReminderSweep };
