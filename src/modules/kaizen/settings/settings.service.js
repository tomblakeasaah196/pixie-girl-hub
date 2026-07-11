/**
 * Kaizen settings service — the Settings screen's read/write surface.
 * Exposes retention, alert recipients, default destination, and whether the
 * frontend ingest key is configured (NEVER the secret value itself).
 */

"use strict";

const { config } = require("../../../config/env");
const repo = require("./settings.repo");
const backupsRepo = require("../backups/backups.repo");
const authRepo = require("../auth/kaizen-auth.repo");

async function getPublic() {
  const [retention, recipients, dest] = await Promise.all([
    repo.get("backup.retention", { daily: 7, weekly: 4, monthly: 6 }),
    repo.get("alerts.recipients", null),
    backupsRepo.getDefaultDestination(),
  ]);
  return {
    retention,
    alert_recipients: recipients, // null = falls back to active operators
    default_destination: dest
      ? { name: dest.name, kind: dest.kind, rclone_remote: dest.rclone_remote }
      : null,
    // Never expose the key; only whether it's set.
    ingest_key_configured: Boolean(config.KAIZEN_INGEST_KEY),
    ingest_allowed_origins: config.KAIZEN_INGEST_ALLOWED_ORIGINS || null,
  };
}

async function update({ input, operatorId, ip }) {
  const changed = {};
  if (input.retention) {
    await repo.set("backup.retention", input.retention);
    changed.retention = input.retention;
  }
  if (input.alert_recipients !== undefined) {
    await repo.set("alerts.recipients", input.alert_recipients);
    changed.alert_recipients = input.alert_recipients;
  }
  await authRepo.writeAudit({
    operatorId, action: "settings.update", targetType: "settings",
    metadata: Object.keys(changed), ip,
  });
  return getPublic();
}

module.exports = { getPublic, update };
