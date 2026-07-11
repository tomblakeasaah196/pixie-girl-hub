/**
 * Scheduled logical backup — 02:30 Africa/Lagos, under withCronLock so only one
 * fleet instance runs it. Delegates to the logical-backup runner (pg_dump +
 * uploads + config → rclone crypt → verify → ledger). See guide §7.10.
 */

"use strict";

const logical = require("../../modules/kaizen/backups/logical-backup");

async function run() {
  return logical.run({ trigger: "scheduled" });
}

module.exports = { run };
