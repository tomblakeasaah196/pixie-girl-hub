/**
 * Nightly appraisal auto-score sweep (V2.2 §6.11, PR-B).
 *
 * For every brand, refreshes the auto-derived KPI scores of each cycle that is
 * currently accepting scores (open / scoring / calibration). Manager-calibrated
 * scores are preserved by the engine. Runs at 02:30 Africa/Lagos so appraisal
 * grids stay current through the scoring window without anyone pressing a
 * button. Fully non-fatal per brand/cycle — one bad cycle never stops the rest.
 */

"use strict";

const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const repo = require("../../shared/hr_payroll/appraisal.repo");
const autoscore = require("../../shared/hr_payroll/appraisal.autoscore");

async function runAppraisalAutoScore() {
  let cyclesRun = 0;
  let scored = 0;
  for (const brand of BRANDS) {
    let cycles = [];
    try {
      cycles = await repo.activeScorableCycles({ brand });
    } catch (err) {
      logger.warn(
        { err: err.message, brand },
        "appraisal auto-score: brand scan failed",
      );
      continue;
    }
    for (const c of cycles) {
      try {
        const r = await autoscore.autoScoreCycle({
          brand,
          cycle_id: c.cycle_id,
          trigger: "scheduled",
        });
        cyclesRun += 1;
        scored += r.scored;
      } catch (err) {
        logger.warn(
          { err: err.message, brand, cycle_id: c.cycle_id },
          "appraisal auto-score: cycle failed",
        );
      }
    }
  }
  logger.info({ cycles: cyclesRun, scored }, "appraisal auto-score sweep done");
  return { cycles: cyclesRun, scored };
}

module.exports = { runAppraisalAutoScore };
