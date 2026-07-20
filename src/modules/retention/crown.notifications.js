/**
 * Crown 👑 in-app notifications — turns actionable Crown events into
 * notifications for the staff who can act on them. Best-effort: failures are
 * logged and swallowed so the source flow is never blocked.
 *
 * Only the actionable event fans out: a MANUAL submission (a UGC photo / an
 * Instagram tag link) that needs a staffer to approve → the users who hold
 * retention `approve` for that brand. At-risk streaks are surfaced as an
 * aggregated sales widget on the Workspace (not per-streak notifications), so
 * a busy programme never spams the bell.
 */

"use strict";

const events = require("./retention.events");
const repo = require("./crown.repo");
const notifications = require("../../services/notifications.service");
const { logger } = require("../../config/logger");

const swallow = (label) => (err) =>
  logger.error({ err: err.message }, `crown notifications: ${label} failed`);

async function notifyApprovers({ brand, submission_id, action_type }) {
  const userIds = await repo.staffWithRetentionAccess({ brand, action: "approve" });
  const label = String(action_type || "reward").replace(/_/g, " ");
  for (const user_id of userIds) {
    await notifications
      .notify({
        user_id,
        business: brand,
        type: "approval_required",
        priority: "normal",
        title: "Crown reward needs approval",
        body: `A Pixie Queen submitted a ${label} for review.`,
        reference_type: "crown_action_submission",
        reference_id: submission_id,
        action_url: "/retention?tab=approvals",
      })
      .catch(swallow(`notify ${user_id}`));
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  events.on("crown.submission_pending", (payload) =>
    notifyApprovers(payload).catch(swallow("submission_pending")),
  );

  logger.info("crown notification subscribers registered (submission_pending → approvers)");
}

register();

module.exports = { register, notifyApprovers };
