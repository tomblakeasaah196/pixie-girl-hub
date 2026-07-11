/**
 * Scheduled restore drill — Sun 04:00 Africa/Lagos, under withCronLock. Proves
 * the latest logical backup restores and measures how long it takes. See guide
 * §7.7 / §7.10.
 */

"use strict";

const drill = require("../../modules/kaizen/backups/restore-drill");

async function run() {
  return drill.run({ trigger: "scheduled" });
}

module.exports = { run };
