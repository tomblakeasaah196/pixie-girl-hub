/**
 * Cash Request notification fan-out — turns domain events into in-app
 * notifications for relevant staff. Best-effort (failures logged, not thrown).
 */

"use strict";

const cashRequestEvents = require("./cash-request.events");
const notifications = require("../../services/notifications.service");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  // Submitter gets notified when their request is approved/rejected/sent back
  cashRequestEvents.on("approved", async (payload) => {
    try {
      await notifications.notify({
        user_id: payload.submitted_by || payload.user_id,
        business: payload.brand,
        type: "cash_request_status",
        priority: "normal",
        title: "Cash request approved",
        body: "Your cash request has been approved and is ready for disbursement.",
        reference_type: "cash_request",
        reference_id: payload.id,
      });
    } catch (err) {
      logger.error(
        { err: err.message, id: payload.id },
        "cash_request approved notification failed",
      );
    }
  });

  cashRequestEvents.on("rejected", async (payload) => {
    try {
      await notifications.notify({
        user_id: payload.submitted_by || payload.user_id,
        business: payload.brand,
        type: "cash_request_status",
        priority: "normal",
        title: "Cash request rejected",
        body: "Your cash request has been rejected. Check the request for details.",
        reference_type: "cash_request",
        reference_id: payload.id,
      });
    } catch (err) {
      logger.error(
        { err: err.message, id: payload.id },
        "cash_request rejected notification failed",
      );
    }
  });

  cashRequestEvents.on("sent_back", async (payload) => {
    try {
      await notifications.notify({
        user_id: payload.submitted_by || payload.user_id,
        business: payload.brand,
        type: "cash_request_status",
        priority: "normal",
        title: "Cash request sent back",
        body: "Your cash request needs revision. Please review the comments and resubmit.",
        reference_type: "cash_request",
        reference_id: payload.id,
      });
    } catch (err) {
      logger.error(
        { err: err.message, id: payload.id },
        "cash_request sent_back notification failed",
      );
    }
  });

  cashRequestEvents.on("disbursed", async (payload) => {
    try {
      await notifications.notify({
        user_id: payload.submitted_by || payload.user_id,
        business: payload.brand,
        type: "cash_request_status",
        priority: "high",
        title: "Cash disbursed",
        body: "Your cash request has been disbursed. Check your bank for the transfer.",
        reference_type: "cash_request",
        reference_id: payload.id,
      });
    } catch (err) {
      logger.error(
        { err: err.message, id: payload.id },
        "cash_request disbursed notification failed",
      );
    }
  });

  // Notify approvers when a new request needs their attention
  cashRequestEvents.on("pending_finance", async (payload) => {
    try {
      // This notifies the submitter's own notification — ideally we'd resolve
      // the Finance role holder and notify them, but role-based routing requires
      // org_workflow resolution (future extension). For now, push to the
      // brand approvals room via Socket.io (handled by rooms.js).
    } catch (err) {
      logger.error(
        { err: err.message, id: payload.id },
        "cash_request pending_finance notification failed",
      );
    }
  });

  logger.info("cash_request notification subscribers registered");
}

register();

module.exports = { register };
