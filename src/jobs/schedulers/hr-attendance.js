/**
 * HR attendance nightly sweep (HR — automation).
 *
 * Runs the daily attendance loop the meeting describes without anyone clicking
 * "Reconcile today":
 *   1. Reconcile today's attendance for each brand (lateness + off-site flags,
 *      auto-queries, earnings snapshot).
 *   2. Bump reminders on open queries past their deadline ("reminds after 2
 *      days while showing the deduction").
 *   3. Apply lapsed off-site penalties (unanswered off-site queries → absent).
 *
 * Fans out across BRANDS. Each brand is isolated so one failure doesn't stop
 * the rest. System-initiated (no `user`), so writes are attributed to the
 * system in audit.
 */

"use strict";

const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const hrOps = require("../../shared/hr_payroll/hr_ops.service");

async function runHrAttendanceSweep() {
  for (const brand of BRANDS) {
    try {
      const rec = await hrOps.reconcileDay({ brand, user: null });
      const rem = await hrOps.bumpDueReminders({ brand });
      const lapse = await hrOps.applyLapsedOffsite({ brand, user: null });
      logger.info(
        {
          brand,
          reconciled: rec.records_created,
          late: rec.late_count,
          offsite: rec.offsite_count,
          reminded: rem.reminded,
          marked_absent: lapse.marked_absent,
        },
        "hr-attendance-sweep complete",
      );
    } catch (err) {
      logger.error({ err, brand }, "hr-attendance-sweep failed for brand");
    }
  }
}

module.exports = { runHrAttendanceSweep };
