/**
 * Scheduled full-volume backup — 03:00 Africa/Lagos, under withCronLock. Kaizen
 * triggers the sudoers-whitelisted restic wrapper and records the snapshot. This
 * is the sole trigger by default; the system cron in ops/kaizen/kaizen-restic-cron
 * is a documented, disabled fallback. See guide §7.10 / §10.4.
 */

"use strict";

const fullvolume = require("../../modules/kaizen/backups/fullvolume-backup");

async function run() {
  return fullvolume.run({ trigger: "scheduled" });
}

module.exports = { run };
