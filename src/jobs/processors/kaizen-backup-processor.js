/**
 * BullMQ processor for the 'kaizen-backup' queue. Manual triggers and reruns
 * enqueue { kind, trigger, createdBy }; this dispatches to the right runner in
 * the worker process (where pg_dump/rclone/restic live and a crash can't take
 * the API down with it). See guide §7.6 / §7.10.
 */

"use strict";

const logical = require("../../modules/kaizen/backups/logical-backup");
const fullvolume = require("../../modules/kaizen/backups/fullvolume-backup");
const restoreDrill = require("../../modules/kaizen/backups/restore-drill");

module.exports = async function kaizenBackupProcessor(job) {
  const { kind, trigger = "manual", createdBy = null } = job.data || {};
  if (kind === "full_volume") {
    return fullvolume.run({ trigger, createdBy });
  }
  if (kind === "restore_drill") {
    return restoreDrill.run({ trigger });
  }
  // default: logical bundle
  return logical.run({ trigger, createdBy });
};
