/**
 * Cash Request notification fan-out — turns domain events into in-app
 * notifications for relevant staff. Best-effort (failures logged, not thrown).
 *
 * Approvals go through the shared approval spine
 * (shared/approvals/approval-requests), so a cash request behaves exactly like
 * a stock adjustment or a workflow-driven expense: each tier gets a
 * deep-linked task + notification when it is their turn, and the decision
 * closes those tasks and tells the submitter. The old "notify approvers"
 * listener here was an empty TODO — a submitted request notified nobody and
 * relied on someone opening the approval queue on the off-chance.
 */

"use strict";

const cashRequestEvents = require("./cash-request.events");
const notifications = require("../../services/notifications.service");
const {
  requestApproval,
  settleApproval,
} = require("../../shared/approvals/approval-requests");
const {
  usersWhoCanApprove,
} = require("../../shared/approvals/approvers.repo");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  // A decision on any tier: close every approver's task for this request and
  // tell the submitter — one call, same shape as every other module.
  const OUTCOMES = {
    approved: "approved",
    rejected: "rejected",
    sent_back: "changes_requested",
    cancelled: "cancelled",
  };
  for (const [event, outcome] of Object.entries(OUTCOMES)) {
    cashRequestEvents.on(event, async (payload) => {
      try {
        await settleApproval({
          brand: payload.brand,
          reference_type: "cash_request",
          reference_id: payload.id,
          outcome,
          requester_user_id: payload.submitted_by || payload.user_id,
          title: "Your cash request",
        });
      } catch (err) {
        logger.error(
          { err: err.message, id: payload.id },
          `cash_request ${event} approval close-out failed`,
        );
      }
    });
  }

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

  // Ask the tier whose turn it is. Finance first; the CEO only for requests
  // over the threshold, and only once Finance has passed it up.
  async function ask({ brand, id, ceoOnly }) {
    const approvers = await usersWhoCanApprove({
      brand,
      module: "cash_request",
    });
    const tier = ceoOnly ? approvers.filter((u) => u.is_ceo) : approvers;
    await requestApproval({
      brand,
      reference_type: "cash_request",
      reference_id: id,
      approver_user_ids: tier.map((u) => u.user_id),
      priority: "high",
      title: ceoOnly
        ? "Approve cash request (CEO sign-off)"
        : "Approve cash request",
      description: "A cash request is waiting for your decision.",
    });
  }

  cashRequestEvents.on("pending_finance", async (payload) => {
    try {
      await ask({ brand: payload.brand, id: payload.id, ceoOnly: false });
    } catch (err) {
      logger.error(
        { err: err.message, id: payload.id },
        "cash_request pending_finance approver ask failed",
      );
    }
  });

  // Finance passed it up: their task is done, the CEO's begins.
  cashRequestEvents.on("pending_ceo", async (payload) => {
    try {
      await settleApproval({
        brand: payload.brand,
        reference_type: "cash_request",
        reference_id: payload.id,
        outcome: "approved",
        requester_user_id: null,
      });
      await ask({ brand: payload.brand, id: payload.id, ceoOnly: true });
    } catch (err) {
      logger.error(
        { err: err.message, id: payload.id },
        "cash_request pending_ceo approver ask failed",
      );
    }
  });

  logger.info("cash_request notification subscribers registered");
}

register();

module.exports = { register };
